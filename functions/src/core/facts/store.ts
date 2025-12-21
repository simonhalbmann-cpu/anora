// functions/src/core/facts/store.ts
// Roadmap 3.3: FactStore (Firestore) – minimal, stabil, domain-agnostisch

import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v2";
import { getOrCreateEntityIdByFingerprint } from "../entities/store";
import { toEntityDomain } from "../entities/types";
import { buildFactId } from "./factId";
import { normalizeFactValueByLocale } from "./locale";
import { normalizeFactKey } from "./semantic";
import type { FactDoc, FactInput } from "./types";

function getDb() {
  // Wichtig: initializeApp muss VORHER in index.ts passieren.
  // Deshalb hier nur admin.firestore() ziehen.
  return admin.firestore();
}

function factsCol(userId: string) {
  return getDb().collection("brain").doc(userId).collection("facts_v1");
}

function evidenceCol(userId: string) {
  return getDb().collection("brain").doc(userId).collection("evidence_v1");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

type EvidenceDoc = {
  evidenceId: string;
  factId: string;
  userId: string;
  entityId: string;
  domain: FactDoc["domain"];
  key: string;
  value: any;
  source: string;
  sourceRef: string;      // z.B. rawEventId
  createdAt: number;
};

function stableStringify(value: any): string {
  const seen = new WeakSet();

  const stringify = (v: any): any => {
    if (v === null) return null;
    if (v === undefined) return "__undefined__"; // nur für Vergleich, NICHT speichern
    if (typeof v !== "object") return v;

    if (seen.has(v)) return "__circular__";
    seen.add(v);

    if (Array.isArray(v)) return v.map(stringify);

    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = stringify(v[k]);
    }
    return out;
  };

  return JSON.stringify(stringify(value));
}

function valuesEqual(a: any, b: any): boolean {
  return stableStringify(a) === stableStringify(b);
}

// Minimal: wir schreiben Facts nach facts_v1/{factId}
export async function upsertManyFacts(
  userId: string,
  facts: FactInput[]
): Promise<{ upserted: number; skipped: number; evidenceAttempted: number }> {
  if (!facts || facts.length === 0) return { upserted: 0, skipped: 0, evidenceAttempted: 0 };

  const col = factsCol(userId);
  const now = Date.now();

  let upserted = 0;
let skipped = 0;
let evidenceAttempted = 0;

  // Firestore batch limit: 500 ops.
  // Wir machen konservativ 300 pro Batch.
  const BATCH_SIZE = 300;

  for (let i = 0; i < facts.length; i += BATCH_SIZE) {
    const slice = facts.slice(i, i + BATCH_SIZE);
    const batch = getDb().batch();

    for (const f of slice) {
      if (!f || typeof f !== "object") {
        skipped++;
        continue;
      }
      if (!f.key) {
  skipped++;
  continue;
}

// 3.5.1: entityId automatisch resolven, falls nicht vorhanden
let entityId =
  typeof (f as any).entityId === "string" && (f as any).entityId.trim()
    ? (f as any).entityId.trim()
    : "";

if (!entityId) {
  const fingerprint =
    typeof (f as any).entityFingerprint === "string"
      ? (f as any).entityFingerprint.trim()
      : "";

  const entityDomain = (f as any).entityDomain;

  // Wenn weder entityId noch genug Infos zum Resolven da sind -> skip
  if (!fingerprint || !entityDomain) {
    skipped++;
    continue;
  }

  const r = await getOrCreateEntityIdByFingerprint({
    userId,
    domain: entityDomain,
    type: (f as any).entityType ?? "generic",
    fingerprint,
    // label/meta optional später – fürs MVP nicht nötig
  });

  entityId = r.entityId;
}

      const rawDomain =
  (f as any).domain ?? (f as any).entityDomain ?? "generic";
const domain = toEntityDomain(rawDomain);
            const validityWindow = f.validity ?? undefined;

            // 3.7: Key normalisieren (Registry) – VOR FactId/Conflict
const key = normalizeFactKey(f.key, domain, f.meta);
if (!key) {
  skipped++;
  continue;
}

// 3.6 Locale Layer (Default de-DE, wenn nicht gesetzt)
const locale =
  (f.meta && typeof f.meta === "object" && typeof (f.meta as any).locale === "string"
    ? String((f.meta as any).locale)
    : "de-DE");

// Value vor FactId + Conflict normalisieren
const normalizedValue = normalizeFactValueByLocale(f.value ?? null, locale);

// 1) FactId deterministisch aus (entityId + key + normalizedValue + validity)
// FIX 3.9: Wenn meta.latest=true -> stabile ID pro (entityId+key), damit es überschreibt
const isLatest =
  !!(f.meta && typeof f.meta === "object" && (f.meta as any).latest === true);

const factId =
  typeof f.factId === "string" && f.factId.trim()
    ? f.factId.trim()
    : buildFactId({
        entityId: entityId,
        key,
        // Wenn latest: Value NICHT in die ID einfließen lassen
        value: isLatest ? "__latest__" : normalizedValue,
        options: { validityWindow },
      });

      // ------------------------------------------------------------
// Evidence v1: pro (factId + sourceRef) ein Beleg
// Wird auch geschrieben, wenn Fact später NO-OP ist.
// ------------------------------------------------------------
const sourceRef =
  typeof f.sourceRef === "string" && f.sourceRef.trim()
    ? f.sourceRef.trim()
    : "";

// Evidence nur, wenn wir eine Quelle haben (bei dir: rawEventId)
if (sourceRef) {
  // evidenceId stabil: gleicher Fact + gleicher RawEvent => gleiche EvidenceId
  // (du brauchst dafür sha256Hex + evidenceCol + EvidenceDoc – wie vorher beschrieben)
  const evidenceId = sha256Hex(`evidence|${factId}|${sourceRef}`);

  const ev: EvidenceDoc = {
    evidenceId,
    factId,
    userId,
    entityId,
    domain,
    key,
    value: normalizedValue,
    source: f.source ?? "other",
    sourceRef,
    createdAt: now,
  };

  const evRef = evidenceCol(userId).doc(evidenceId);
  batch.set(evRef, ev, { merge: true });
  evidenceAttempted++;
}

// Phase 2: KEIN Index im Write-Pfad.
// conflict wird nicht mehr "erraten", nur noch übernommen, falls explizit gesetzt.
const conflict = f.conflict === true ? true : false;

// 3) Doc bauen (ohne undefined in Firestore zu schreiben)
const doc: FactDoc = {
  factId,
  entityId: entityId,
  domain,
  key,
  value: normalizedValue,

  source: f.source ?? "other",
  conflict,

  createdAt: typeof f.createdAt === "number" ? f.createdAt : now,
  updatedAt: now,

  // Optional fields (nur schreiben, wenn vorhanden)
  ...(typeof f.unit === "string" && f.unit.trim()
    ? { unit: f.unit.trim() }
    : {}),

  ...(typeof f.sourceRef === "string" && f.sourceRef.trim()
    ? { sourceRef: f.sourceRef.trim() }
    : {}),

  ...(typeof f.confidence === "number"
    ? { confidence: f.confidence }
    : {}),

  ...(f.validity !== undefined ? { validity: f.validity } : {}),

  ...(f.meta && typeof f.meta === "object" ? { meta: f.meta } : {}),
};

      const ref = col.doc(factId);
      batch.set(ref, doc, { merge: true });
      upserted++;
    }

    await batch.commit();
  }

  logger.info("factStore_upsertMany_done", { userId, upserted, skipped, evidenceAttempted });

  return { upserted, skipped, evidenceAttempted };
}

export type FactQuery = {
  entityId?: string;
  key?: string;
  domain?: string;
  limit?: number;
};

// Minimal-Query: entityId/key/domain filtern (einfach, kein Volltext)
export async function queryFacts(
  userId: string,
  q: FactQuery
): Promise<Array<{ id: string; data: FactDoc }>> {
  const col = factsCol(userId);

  let ref: FirebaseFirestore.Query = col;

  if (q.entityId) {
    ref = ref.where("entityId", "==", q.entityId);
  }
  if (q.key) {
    ref = ref.where("key", "==", q.key);
  }
  if (q.domain) {
    ref = ref.where("domain", "==", q.domain);
  }

  ref = ref.orderBy("factId", "asc");

  const limit = typeof q.limit === "number" && q.limit > 0 ? q.limit : 50;
  ref = ref.limit(Math.min(limit, 200));

  const snap = await ref.get();

const items = snap.docs.map((d) => ({ id: d.id, data: d.data() as FactDoc }));

return items;
}