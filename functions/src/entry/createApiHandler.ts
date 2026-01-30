import type { Request, Response } from "express";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeFactMeta } from "../core/facts/factMeta";
import type { FactDoc } from "../core/facts/types";

import type { CoreHaltungV1 } from "../core/haltung/types";

import {
  runCoreWithPersistence,
  type RunCoreWithPersistenceInput,
} from "../core/runCoreWithPersistence";

import { runLlmBrainSatellite } from "../core/satellites/llmBrain";
import type { BrainInput } from "../core/satellites/types";

import {
  BRAIN_SYSTEM_PROMPT_DE,
  BRAIN_SYSTEM_PROMPT_DE_VERSION,
} from "../prompt";

import {
  parseDailyDigestDoc,
  parsePresenceActiveDoc,
  parsePresenceSettingsDoc,
  parsePresenceTopicsDoc,
} from "../core/meta/contracts";

function truncateTailOnly(raw: unknown, max: number): string {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return "";
  if (!Number.isFinite(max) || max <= 0) return "";
  if (s.length <= max) return s;
  return s.slice(-max);
}

function isEmulator(): boolean {
  const v = (x: any) => String(x ?? "").toLowerCase();

  const functionsEmu =
    v(process.env.FUNCTIONS_EMULATOR) === "true" ||
    v(process.env.FUNCTIONS_EMULATOR) === "1";

  const firebaseEmu =
    v(process.env.FIREBASE_EMULATOR_HUB) !== "" ||
    v(process.env.FIRESTORE_EMULATOR_HOST) !== "" ||
    v(process.env.FIREBASE_AUTH_EMULATOR_HOST) !== "";

  const forcedOff = v(process.env.DEV_FORCE_DISABLE) === "true";

  return (functionsEmu || firebaseEmu) && !forcedOff;
}

function readToken(req: Request, headerName: string, queryName: string): string {
  const headerVal = req.header(headerName);
  const headerToken = typeof headerVal === "string" ? headerVal : "";

  const queryAny = req.query as any;
  const queryToken = typeof queryAny?.[queryName] === "string" ? String(queryAny[queryName]) : "";

  return headerToken || queryToken;
}

function requireDevAccessOr403(req: Request, res: Response): boolean {
  try {
    // Kill-Switch: kann alles abschalten (auch Emulator)
    if (process.env.DEV_FORCE_DISABLE === "true") {
      res.status(403).json({ ok: false, error: "DEV endpoint disabled" });
      return false;
    }

    // Secret muss in PROD gesetzt sein (und wir nutzen es auch im Emulator, wenn gesetzt)
    const secret = process.env.DEV_API_SECRET || "";

    const token = readToken(req, "x-dev-secret", "devSecret");

    // Emulator: wenn kein Secret gesetzt ist -> erlauben (bequem fÃ¼rs lokale Entwickeln)
    if (isEmulator() && !secret) return true;

    // PROD (oder Emulator mit gesetztem Secret): Secret muss existieren
    if (!secret) {
      res.status(500).json({ ok: false, error: "DEV_API_SECRET not set" });
      return false;
    }

    // Token muss stimmen
    if (!token || token !== secret) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return false;
    }

    return true;
  } catch (e) {
    res.status(500).json({ ok: false, error: "DEV guard failed", detail: String(e) });
    return false;
  }
}

function hasDevAccess(req: Request): boolean {
  // Kill-Switch respektieren
  if (process.env.DEV_FORCE_DISABLE === "true") return false;

  const secret = (process.env.DEV_API_SECRET ?? "").trim();
  const token = readToken(req, "x-dev-secret", "devSecret");

  // Emulator: wenn kein Secret gesetzt ist -> erlauben (wie deine Dev-Logik)
  if (isEmulator() && !secret) return true;

  if (!secret) return false;
  return token === secret;
}

async function requireUserAuthOr401(req: Request, res: Response): Promise<{ uid: string } | null> {
  try {
    const h = req.header("authorization") || req.header("Authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";

    if (!token) {
      res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
      return null;
    }

    // âœ… Emulator-Fallback: unsignierte Emulator-Tokens (alg=none, endet mit ".") akzeptieren
    // WICHTIG: nur im Emulator erlauben!
    if (isEmulator()) {
      try {
        // JWT: header.payload.signature (bei Emulator ist signature oft leer -> Token endet mit ".")
        const parts = token.split(".");
        if (parts.length >= 2) {
          const payloadB64 = parts[1];

          // base64url -> base64
          const payloadJson = Buffer.from(
            payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payloadB64.length + 3) % 4),
            "base64"
          ).toString("utf8");

          const payload = JSON.parse(payloadJson);

          // Emulator nutzt oft "user_id" (wie in deinem Log). Fallbacks: uid/sub.
          const uid = String(payload?.user_id ?? payload?.uid ?? payload?.sub ?? "");

          if (uid) return { uid };
        }
      } catch {
        // wenn parsing nicht klappt, geht's weiter zur normalen verifyIdToken-Route
      }
    }

    const decoded = await getAuth().verifyIdToken(token);
    if (!decoded?.uid) {
      res.status(401).json({ ok: false, error: "Invalid token" });
      return null;
    }

    return { uid: decoded.uid };
  } catch (e) {
    res.status(401).json({ ok: false, error: "Unauthorized", detail: String(e) });
    return null;
  }
}

type LoggerLike = {
  error: (msg: string, meta?: any) => void;
  info?: (msg: string, meta?: any) => void;
  warn?: (msg: string, meta?: any) => void;
};

type OpenAIClientLike = {
  chat: {
    completions: {
      create: (args: any) => Promise<any>;
    };
  };
};

export type ApiHandlerDeps = {
  logger: LoggerLike;

  // impure deps, injected from index.ts
  getOpenAI: () => OpenAIClientLike;
  safeParseAssistantJson: (raw: string) => any;

  // optional: read current haltung from storage (impure)
  readHaltung?: (userId: string) => Promise<unknown | undefined>;

  // read active facts from storage (impure)
  readFacts?: (userId: string) => Promise<FactDoc[]>;

  // model config
  model: string;
};

function asString(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function clamp01(n: any, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

function normalizeHaltungDoc(d: any): CoreHaltungV1 {
  return {
    version: 1,
    directness: clamp01(d?.directness, 0.5),
    interventionDepth: clamp01(d?.interventionDepth, 0.5),
    patience: clamp01(d?.patience, 0.5),
    escalationThreshold: clamp01(d?.escalationThreshold, 0.7),
    reflectionLevel: clamp01(d?.reflectionLevel, 0.5),
    updatedAt: typeof d?.updatedAt === "number" ? d.updatedAt : 0,
  };
}

export function createApiHandler(deps: ApiHandlerDeps) {
  return async function apiHandler(req: Request, res: Response): Promise<void> {



deps.logger.info?.("api_handler_hit", {
  rawPath: String((req as any).path ?? ""),
  url: String((req as any).originalUrl ?? ""),
});

    
    try {
      // Admin SDK init (idempotent)
      if (!getApps().length) initializeApp();
      const adminDb = getFirestore();

      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Only POST allowed" });
        return;
      }



      // ROUTING: /api/<endpoint>
// In Firebase/Express kann req.path bei einem Mount auf "/api" auch nur "/" sein.
// Wir behandeln "/" als Default-Chat-Endpoint.
const rawPath = String((req as any).path ?? "").trim();
const path = rawPath === "" || rawPath === "/" ? "/anoraChat" : rawPath;


// Body kann Objekt oder String sein (Firebase kann String liefern)
let body: any = req.body;
if (typeof body === "string") {
  try {
    body = JSON.parse(body);
  } catch {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }
}

// ------------------------------------------------------------
// PRESENCE SETTINGS + TOPICS (auth-only, body-userId verboten)
// ------------------------------------------------------------

if (path === "/anoraPresenceSettings") {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;
  const userId = auth.uid;

  // Body-userId strikt verbieten
  if (body && typeof body === "object" && "userId" in body) {
  res.status(400).json({ ok: false, error: "Do not send userId. Derived from auth token." });
  return;
}

  const enabled = typeof body?.enabled === "boolean" ? body.enabled : undefined;
  const ref = adminDb.doc(`brain/${userId}/meta/presence_settings`);

  if (enabled === undefined) {
    // READ
    const snap = await ref.get();
    const cur = snap.exists ? parsePresenceSettingsDoc(snap.data()) : { enabled: false };
res.status(200).json({ ok: true, enabled: cur.enabled === true });
    return;
  }

  // WRITE
  await ref.set({ enabled, updatedAt: Date.now() }, { merge: true });
  res.status(200).json({ ok: true, enabled });
  return;
}

// ------------------------------------------------------------
// CONFLICTS (auth-only)
// ------------------------------------------------------------
if (path === "/anoraConflictsList") {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;
  const userId = auth.uid;

  const snap = await adminDb
    .collection(`brain/${userId}/meta`)
    .where("status", "==", "open")
    .get();

  const conflicts = snap.docs
    .filter((d) => d.id.startsWith("conflict_v1__"))
    .map((d) => ({
      id: d.id,
      ...(d.data() as any),
    }));

  res.status(200).json({ ok: true, count: conflicts.length, conflicts });
  return;
}

if (path === "/anoraConflictsResolve") {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;

  const userId = auth.uid;

  // Body: { entityId, key, chosenFactId, note? }
  const entityId = typeof body?.entityId === "string" ? body.entityId.trim() : "";
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const chosenFactId =
    typeof body?.chosenFactId === "string" ? body.chosenFactId.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!entityId || !key || !chosenFactId) {
    res.status(400).json({
      ok: false,
      error: "Missing entityId/key/chosenFactId",
    });
    return;
  }

  // conflict doc id ist deterministisch
  const docId = `conflict_v1__${entityId}__${key}`;
  const ref = adminDb.doc(`brain/${userId}/meta/${docId}`);

  // Markiere als resolved (wir lÃ¶schen nichts!)
  await ref.set(
    {
      status: "resolved",
      resolvedByFactId: chosenFactId,
      userNote: note || null,
      updatedAt: Date.now(),
    },
    { merge: true }
  );


  // --------------------------------------------------
// PHASE 4.1: User-Override-Fact schreiben
// --------------------------------------------------

const factsCol = adminDb.collection(`brain/${userId}/facts`);

// gewÃ¤hlten Fact laden (Quelle fÃ¼r value)
const chosenSnap = await factsCol.doc(chosenFactId).get();
if (!chosenSnap.exists) {
  res.status(404).json({ ok: false, error: "Chosen fact not found" });
  return;
}

const chosenFact = chosenSnap.data() as any;
const now = Date.now();

// neuer Override-Fact (lÃ¶scht nichts!)
const overrideFact = {
  factId: `user_override__${chosenFactId}__${now}`,
  entityId,
  domain: chosenFact.domain,
  key,
  value: chosenFact.value,

  source: "user_override",
  sourceRef: chosenFactId,

  createdAt: now,
  updatedAt: now,

  meta: {
    assertedBy: "user",
    override: true,
    sourceType: "user",
    finality: "final",
    confidence: 1,
  },
};

await factsCol.doc(overrideFact.factId).set(overrideFact);

  res.status(200).json({ ok: true, id: docId });
  return;
}

if (path === "/anoraPresenceTopics") {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;
  const userId = auth.uid;

  // Body-userId strikt verbieten
  if (body && typeof body === "object" && "userId" in (body as any)) {
    res.status(400).json({ ok: false, error: "Do not send userId. Derived from auth token." });
    return;
  }

  const ref = adminDb.doc(`brain/${userId}/meta/presence_topics`);
  const snap = await ref.get();
  const cur = snap.exists ? parsePresenceTopicsDoc(snap.data()) : { topics: {} };
const topics = cur.topics;

  const topic = typeof body?.topic === "string" ? String(body.topic) : "";
  const muted = typeof body?.muted === "boolean" ? body.muted : undefined;

  // READ
  if (!topic || muted === undefined) {
    res.status(200).json({ ok: true, topics });
    return;
  }

  // WRITE (mute/unmute)
  const now = Date.now();
  const prev = topics?.[topic] && typeof topics[topic] === "object" ? topics[topic] : {};

  const next = {
    ...topics,
    [topic]: muted
      ? { ...prev, lastDisabledAt: now }
      : { ...prev, lastDisabledAt: 0 },
  };

  await ref.set({ topics: next, updatedAt: now }, { merge: true });
  res.status(200).json({ ok: true, topics: next });
  return;
}

// ------------------------------------------------------------
// PRESENCE ENDPOINTS (auth-only, body-userId verboten)
// ------------------------------------------------------------

if (path === "/anoraPresenceAction") {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;

  // Body-userId strikt verbieten
  if (body && typeof body === "object" && "userId" in (body as any)) {
    res.status(400).json({
      ok: false,
      error: "Do not send userId. Derived from auth token.",
    });
    return;
  }

  // TODO: spÃ¤ter echte Action-Logik
  res.status(200).json({ ok: true });
  return;
}

if (path === "/anoraPresence") {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;
  const userId = auth.uid;

  // Body-userId strikt verbieten
  if (body && typeof body === "object" && "userId" in (body as any)) {
    res.status(400).json({
      ok: false,
      error: "Do not send userId. Derived from auth token.",
    });
    return;
  }

  try {
    const day = new Date().toISOString().slice(0, 10);

    const digestDocId = `dailyDigest_v1__${day}`;
const presenceDocId = `presence_v1__active`;

const digestRef = adminDb.doc(`brain/${userId}/meta/${digestDocId}`);
const presenceRef = adminDb.doc(`brain/${userId}/meta/${presenceDocId}`);

const [digestSnap, presenceSnap] = await Promise.all([
  digestRef.get(),
  presenceRef.get(),
]);

const digestRaw = digestSnap.exists ? parseDailyDigestDoc(digestSnap.data()) : null;
const presenceRaw = presenceSnap.exists ? parsePresenceActiveDoc(presenceSnap.data()) : null;

const digest = digestRaw
  ? {
      id: digestDocId,
      title: "Zusammenfassung",
      message: digestRaw.message,
      createdAt: digestRaw.createdAt,
      source: digestRaw.source ?? "dailyDigest",
      status: digestRaw.status ?? "active",
    }
  : null;

const presence = presenceRaw
  ? {
      id: presenceDocId,
      title: "Offenes Thema",
      type: presenceRaw.type,
      message: presenceRaw.message,
      createdAt: presenceRaw.createdAt,
      source: presenceRaw.source ?? "presence",
      status: presenceRaw.status ?? "active",
    }
  : null;

    if (!digest && !presence) {
      res.status(204).send("");
      return;
    }

    res.status(200).json({ ok: true, digest, presence });
    return;
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "unknown_error");
    deps.logger.error("anoraPresence_failed", { msg });
    res.status(500).json({ ok: false, error: msg });
    return;
  }
}

// FÃ¼r NICHT-auth Endpoints (Chat/Dev/Reset etc.)
const bodyUserId = asString(body?.userId).trim();
// ------------------------------------------------------------
// Ab hier: alle anderen Endpoints brauchen userId im Body
// ------------------------------------------------------------
const userId = bodyUserId;
if (!userId) {
  res.status(400).json({ ok: false, error: "Missing userId" });
  return;
}

      // ------------------------------------------------------------
// DEV endpoints (nur Emulator + Secret)
// ------------------------------------------------------------

if (path.endsWith("/devSeedFacts")) {
  if (!requireDevAccessOr403(req, res)) return;

  const now = Date.now();
  const factsCol = adminDb.collection(`brain/${userId}/facts`);

  await factsCol.add({
    key: "rent_cold",
    value: 1200,
    domain: "real_estate",
    source: "devSeedFacts",
    createdAt: now,
    updatedAt: now,
  });

  await factsCol.add({
    key: "city",
    value: "Berlin",
    domain: "real_estate",
    source: "devSeedFacts",
    createdAt: now,
    updatedAt: now,
  });

  res.status(200).json({ ok: true, seeded: ["rent_cold", "city"] });
  return;
}

if (path === "/devSeedHaltung") {
  if (!requireDevAccessOr403(req, res)) return;

  const now = Date.now();
  await adminDb.doc(`brain/${userId}/meta/haltung`).set(
    {
      version: 1,
      directness: 0.9,
      interventionDepth: 0.7,
      patience: 0.2,
      escalationThreshold: 0.7,
      reflectionLevel: 0.5,
      updatedAt: now,
      source: "devSeedHaltung",
    },
    { merge: true }
  );

  res.status(200).json({ ok: true });
  return;
}

if (path === "/devReadFactsCount") {
  if (!requireDevAccessOr403(req, res)) return;

  const snap = await adminDb.collection(`brain/${userId}/facts`).get();
  res.status(200).json({ ok: true, count: snap.size });
  return;
}


if (path === "/devListFacts") {
  if (!requireDevAccessOr403(req, res)) return;

  // Optionaler Filter per Body: { limit: number }
  const limRaw = (body as any)?.limit;
  const lim = typeof limRaw === "number" && Number.isFinite(limRaw) ? Math.max(1, Math.min(500, limRaw)) : 200;

  const snap = await adminDb
    .collection(`brain/${userId}/facts`)
    .orderBy("updatedAt", "desc")
    .limit(lim)
    .get();

  const facts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

// DEBUG: Doppel-Keys pro entityId sichtbar machen
  const counts: Record<string, number> = {};
  for (const f of facts as any[]) {
    const key = String(f?.key ?? "?");
    const entityId = String(f?.entityId ?? "null");
    const sig = `${entityId}::${key}`;
    counts[sig] = (counts[sig] ?? 0) + 1;
  }

  const duplicates = Object.entries(counts)
    .filter(([, n]) => n > 1)
    .map(([sig, n]) => ({ sig, n }));

  console.log("DEV devListFacts duplicates(entityId::key):", duplicates);

  // ---------------------------------------------
  // DEV: Duplicate VALUES (entityId::key::value)
  // ---------------------------------------------

  function stableValueSig(v: any): string {
    try {
      if (v === null || v === undefined) return String(v);
      if (typeof v !== "object") return String(v);
      const keys = Object.keys(v).sort();
      const norm: any = {};
      for (const k of keys) norm[k] = v[k];
      return JSON.stringify(norm);
    } catch {
      return "[unserializable]";
    }
  }

  const valueCounts: Record<string, { n: number; sampleFactIds: string[] }> = {};

  for (const f of facts as any[]) {
    const entityId = String(f?.entityId ?? "null");
    const key = String(f?.key ?? "?");
    const valueSig = stableValueSig(f?.value);
    const sig = `${entityId}::${key}::${valueSig}`;

    if (!valueCounts[sig]) {
      valueCounts[sig] = { n: 0, sampleFactIds: [] };
    }
    valueCounts[sig].n += 1;
    if (valueCounts[sig].sampleFactIds.length < 3) {
      valueCounts[sig].sampleFactIds.push(String(f?.factId ?? f?.id ?? "?"));
    }
  }

  const duplicateValues = Object.entries(valueCounts)
    .filter(([, info]) => info.n > 1)
    .map(([sig, info]) => ({
      sig,
      n: info.n,
      sampleFactIds: info.sampleFactIds,
    }));

  console.log(
    "DEV devListFacts duplicate VALUES (entityId::key::value):",
    duplicateValues
  );

  // Entities sichtbar: wir geben entityId + key + value + meta + isSuperseded aus
  res.status(200).json({
    ok: true,
    count: facts.length,
    facts: facts.map((f: any) => ({
      id: f.id,
      key: f.key,
      value: f.value,
      entityId: f.entityId ?? null,
      meta: f.meta ?? null,
      isSuperseded: f.isSuperseded ?? null,
      createdAt: f.createdAt ?? null,
      updatedAt: f.updatedAt ?? null,
      source: f.source ?? null,
    })),
  });
  return;
}


if (path === "/devReadHaltung") {
  if (!requireDevAccessOr403(req, res)) return;

  const snap = await adminDb.doc(`brain/${userId}/meta/haltung`).get();
  res
    .status(200)
    .json({ ok: true, exists: snap.exists, data: snap.exists ? snap.data() : null });
  return;
}

if (path === "/devListMetaDocs") {
  if (!requireDevAccessOr403(req, res)) return;

  const docs = await adminDb.collection(`brain/${userId}/meta`).get();

  res.status(200).json({
    ok: true,
    count: docs.size,
    ids: docs.docs.map((d) => d.id),
  });
  return;
}

if (path === "/devSeedDigest") {
  if (!requireDevAccessOr403(req, res)) return;

  const now = Date.now();
  const yyyyMmDd = new Date(now).toISOString().slice(0, 10); // 2026-01-13
  const id = `dailyDigest_v1__${yyyyMmDd}`;

  await adminDb.doc(`brain/${userId}/meta/${id}`).set(
    {
      version: 1,
      kind: "dailyDigest_v1",
      createdAt: now,
      message: "DEV DIGEST: Test-Digest fÃ¼r UI (Presence-Karte).",
      source: "devSeedDigest",
    },
    { merge: true }
  );

  res.status(200).json({ ok: true, id });
  return;
}

if (path === "/devSetMetaDoc") {
  if (!requireDevAccessOr403(req, res)) return;

  // Body kann hier schon geparst sein (bei dir: ja)
  const docId = asString((body as any)?.docId).trim();
  const data = (body as any)?.data;

  if (!docId) {
    res.status(400).json({ ok: false, error: "Missing docId" });
    return;
  }
  if (!data || typeof data !== "object") {
    res.status(400).json({ ok: false, error: "Missing data object" });
    return;
  }

  await adminDb.doc(`brain/${userId}/meta/${docId}`).set(
    { ...data, updatedAt: Date.now() },
    { merge: true }
  );

  res.status(200).json({ ok: true, docId });
  return;
}

if (path === "/devGetMetaDoc") {
  if (!requireDevAccessOr403(req, res)) return;

  const docId = asString((body as any)?.docId).trim();
  if (!docId) {
    res.status(400).json({ ok: false, error: "Missing docId" });
    return;
  }

  const ref = adminDb.doc(`brain/${userId}/meta/${docId}`);
  const snap = await ref.get();

  res.status(200).json({
    ok: true,
    docId,
    exists: snap.exists,
    data: snap.exists ? snap.data() : null,
  });
  return;
}

      // 3) Reset knowledge (wipe brain/{uid}/facts + meta docs we own)
if (path.endsWith("/resetUserKnowledge")) {

  // DEV-Secret erlaubt ODER eingeloggter User selbst
if (!hasDevAccess(req)) {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;

  if (auth.uid !== userId) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }
}

  // -------------------------
// A) Facts lÃ¶schen (Core + Ingest)
// -------------------------
const coreFactsCol = adminDb.collection(`brain/${userId}/facts`);
const coreFactsSnap = await coreFactsCol.get();
const coreFactRefs = coreFactsSnap.docs.map((d) => d.ref);

const ingestFactsCol = adminDb.collection(`brain/${userId}/ingest_facts_v1`);
const ingestFactsSnap = await ingestFactsCol.get();
const ingestFactRefs = ingestFactsSnap.docs.map((d) => d.ref);

const factRefs = [...coreFactRefs, ...ingestFactRefs];

  // -------------------------
  // B) Meta lÃ¶schen (Digest + Presence)
  // -------------------------
  const metaCol = adminDb.collection(`brain/${userId}/meta`);
  const metaSnap = await metaCol.get();

  const metaRefsToDelete: FirebaseFirestore.DocumentReference[] = [];

  metaSnap.docs.forEach((d) => {
    const id = d.id;

    const isDailyDigest = id.startsWith("dailyDigest_v1__");
    const isPresenceEvent = id.startsWith("presence_v1__");
    const isPresenceTopics = id === "presence_topics";
    const isPresenceSettings = id === "presence_settings";

    if (isDailyDigest || isPresenceEvent || isPresenceTopics || isPresenceSettings) {
      metaRefsToDelete.push(d.ref);
    }
  });

  // -------------------------
  // C) Batch delete in Chunks
  // -------------------------
  async function deleteInChunks(refs: FirebaseFirestore.DocumentReference[]) {
    const CHUNK = 450;
    for (let i = 0; i < refs.length; i += CHUNK) {
      const batch = adminDb.batch();
      refs.slice(i, i + CHUNK).forEach((r) => batch.delete(r));
      await batch.commit();
    }
  }

  await deleteInChunks(factRefs);
  await deleteInChunks(metaRefsToDelete);

  res.status(200).json({
    ok: true,
    deleted: {
      facts: factRefs.length,
      meta: metaRefsToDelete.length,
      metaIds: metaRefsToDelete.map((r) => r.id),
    },
  });
  return;
}

      // 4) Reset personality (haltung etc.)
      if (path.endsWith("/resetUserPersonality")) {

        // DEV-Secret erlaubt ODER eingeloggter User selbst
if (!hasDevAccess(req)) {
  const auth = await requireUserAuthOr401(req, res);
  if (!auth) return;

  if (auth.uid !== userId) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }
}
        // Beispiel: haltung doc lÃ¶schen, falls du es so speicherst
        await adminDb.doc(`brain/${userId}/meta/haltung`).delete().catch(() => null);
        res.status(200).json({ ok: true });
        return;
      }

      const text = asString(body?.message ?? body?.text).trim();

      // CHAT: llmBrain standardmäßig AN (nur explizit abschaltbar)
const useSatellite = body?.useSatellite !== false; // default true

      // ðŸ”§ INGEST-SWITCH (minimal): Wenn Text mit "INGEST:" startet -> Brain AUS
const isIngest = text.startsWith("INGEST:");
const effectiveUseSatellite = isIngest ? false : useSatellite;

      const MAX_USER_MESSAGE = 4000; // Phase A: fix. SpÃ¤ter evtl. config/env.

const textForBrain = truncateTailOnly(text, MAX_USER_MESSAGE);

deps.logger?.info?.("brain_truncated_message_len", {
  maxUserMessageLength: MAX_USER_MESSAGE,
  originalLen: typeof text === "string" ? text.length : -1,
  truncatedLen: textForBrain.length,
  hasBEGIN: textForBrain.includes("BEGIN_MARKER_"),
  hasEND: textForBrain.includes("END_MARKER_"),
  tailPreview: textForBrain.slice(-160),
});

deps.logger?.info?.("api_chat_text_len", { len: text.length, useSatellite: effectiveUseSatellite });

      const userName =
        typeof body?.userName === "string" ? body.userName : undefined;


// Ab hier: nur Chat/Core-Endpunkte brauchen message/text
      if (path !== "/anoraChat") {
        res.status(404).json({ ok: false, error: `Unknown endpoint: ${path}` });
        return;
      }

      if (!text) {
        res.status(400).json({ ok: false, error: "Missing message" });
        return;
      }

      // Optional: Haltung laden (impure via deps.readHaltung)
      let haltung: CoreHaltungV1 | undefined = undefined;
      if (deps.readHaltung) {
        try {
          const raw = await deps.readHaltung(userId);
          haltung = raw ? normalizeHaltungDoc(raw as any) : undefined;
        } catch {
          haltung = undefined;
        }
      }

      // Facts-Quelle:
// - Wenn der Client state.facts sendet, nutzen wir DIE (für Tests/CORE-CLARIFY).
// - Sonst laden wir serverseitig (normaler Betrieb).
let facts: FactDoc[] = [];

const clientFacts = Array.isArray(body?.state?.facts) ? body.state.facts : null;

if (clientFacts) {
  facts = clientFacts.map((f: any) => ({
    ...f,
    meta: normalizeFactMeta((f?.meta ?? {}) as any),
  })) as any;
} else if (deps.readFacts) {
  try {
    facts = (await deps.readFacts(userId)).map((f) => ({
      ...f,
      meta: normalizeFactMeta((f.meta ?? {}) as any),
    }));
  } catch {
    facts = [];
  }
}




deps.logger.info?.("chat_loaded_facts", {
  userId,
  factCount: facts.length,
  factKeys: facts.map(f => f.key),
});


deps.logger.info?.("chat_request_facts", {
  userId,
  hasBodyFacts: Array.isArray(body?.state?.facts),
  bodyFactCount: Array.isArray(body?.state?.facts) ? body.state.facts.length : 0,
  bodyFactKeys: Array.isArray(body?.state?.facts) ? body.state.facts.map((f: any) => f?.key) : [],
});



      // Persistenz ist ab jetzt DEFAULT
// dryRun nur, wenn explizit true gesendet wird
const dryRun = Boolean(body?.dryRun);
      const extractorIds = Array.isArray(body?.extractorIds)
  ? body.extractorIds
  : undefined;

      const input: RunCoreWithPersistenceInput = {
        userId,
        text,
        dryRun,
        extractorIds,
        state: {
          locale: asString(body?.state?.locale ?? "de-DE"),
          facts: [
  ...facts,
  ...(
    Array.isArray(body?.state?.facts)
      ? body.state.facts.map((f: any) => ({
          ...f,
          meta: normalizeFactMeta((f?.meta ?? {}) as any),
        }))
      : []
  ),
],
          haltung,
        },
      };

      const llmDeps = {
        openai: deps.getOpenAI(),
        model: deps.model,

        systemPrompt: BRAIN_SYSTEM_PROMPT_DE,
        systemPromptVersion: BRAIN_SYSTEM_PROMPT_DE_VERSION,

        maxFactsPerPrompt: 30,
        maxKnowledgeSummaryLength: 80000,
        maxHistoryTurns: 12,
        maxHistorySummaryLength: 4000,

        safeParseAssistantJson: deps.safeParseAssistantJson,

        fallbackCopy: {
          invalidJson: "Antwort war kein gÃ¼ltiges JSON.",
          genericError: "Es ist ein Fehler passiert.",
        },
      } as const;


      const out = await runCoreWithPersistence(input);

// --- CORE-CLARIFY hat absolute Priorität (auch wenn useSatellite=false) ---
const clarify = (out as any)?.clarify ?? null;

// Canonical / neutral clarify reply (Frage + Optionen, sonst NICHTS)
function buildClarifyReply(c: any): string {
  const q = String(c?.question ?? "").trim();
  const candidates = Array.isArray(c?.candidates) ? c.candidates : [];

  const lines = candidates
    .map((x: any, i: number) => {
      const factId = String(x?.factId ?? "").trim();
      const value = x?.value;
      const valueStr = typeof value === "string" ? value : JSON.stringify(value);
      return `${i + 1}) ${factId}: ${valueStr}`;
    })
    .filter((s: any) => typeof s === "string" && s.trim().length > 0);

  return lines.length ? `${q}\n${lines.join("\n")}` : q;
}

// HARD VALIDATION: darf nur "Frage + Optionen" sein (neutral, keine Zusätze)
function assertNeutralClarifyReply(reply: string, c: any): void {
  const canonical = buildClarifyReply(c);

  // 1) Muss exakt canonical sein
  if (reply !== canonical) {
    throw new Error("clarify_reply_invalid:non_canonical");
  }

  // 2) Kein suggestiver Zusatztext (Sicherheitsnetz)
  const banned = ["Kandidaten:", "Ich denke", "Ich würde", "Vielleicht", "Du solltest", "Du musst"];
  for (const b of banned) {
    if (reply.includes(b)) throw new Error("clarify_reply_invalid:tone");
  }
}

if (
  clarify &&
  typeof clarify === "object" &&
  typeof (clarify as any).question === "string" &&
  Array.isArray((clarify as any).candidates)
) {
  const reply = buildClarifyReply(clarify);
  assertNeutralClarifyReply(reply, clarify);

  res.status(200).json({ ok: true, out, reply });
  return;
}

      // --- server-side knowledge summary for Brain (active facts only) ---
const factsForSummary = Array.isArray((out as any)?.validatedFacts)
  ? (out as any).validatedFacts
  : (Array.isArray((input.state as any)?.facts) ? (input.state as any).facts : []);

const knowledgeSummary = factsForSummary.slice(0, 30).map((f: any) => ({
  key: f.key,
  value: f.value,
  domain: f.domain,
  entityId: f.entityId,
}));

// ðŸ”’ HARTE TRENNUNG: Ingest / Golden Test = KEIN Brain
if (!effectiveUseSatellite) {
  const isIngest = text.startsWith("INGEST:");
  res.status(200).json({
    ok: true,
    out,
    reply: isIngest ? "Gespeichert." : "",
  });
  return;
}

// --- AB HIER NUR CHAT / BRAIN ---
let reply: string | null = null;

deps.logger?.info?.("brain_input_message_len", { len: textForBrain.length });
deps.logger?.info?.("brain_input_message_head_tail", {
  head: text.slice(0, 120),
  tail: text.slice(Math.max(0, text.length - 120)),
});

const brainInput: BrainInput = {
  userId,
  userName,
  message: textForBrain,
  knowledge: knowledgeSummary,
  history: Array.isArray(body?.brain?.history) ? body.brain.history : [],
  contexts: body?.brain?.contexts ?? null,
};

const interventionCandidate =
  (out as any)?.intervention ?? (out as any)?.core?.intervention ?? null;

const coreForSatellite =
  interventionCandidate ? { intervention: interventionCandidate } : undefined;

const brainOut = await runLlmBrainSatellite(
  llmDeps as any,
  brainInput,
  coreForSatellite
);

reply = brainOut.reply ?? "";

res.status(200).json({ ok: true, out, reply });
    } catch (err: any) {
  const msg = String(err?.message ?? err ?? "unknown_error");
  const stack = typeof err?.stack === "string" ? err.stack : null;

  deps.logger.error("apiHandler_failed", { msg, stack });

  // Im Emulator wollen wir den echten Fehler sehen, sonst stochern wir im Nebel.
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    res.status(500).json({ ok: false, error: msg, stack });
    return;
  }

  res.status(500).json({ ok: false, error: "Internal server error" });
}
  };
}




