// functions/src/core/facts/store.ts
// Roadmap 3.3: FactStore (Firestore) â€“ minimal, stabil, domain-agnostisch

import { createHash } from "crypto";
import { logger } from "firebase-functions/v2";
import { toEntityDomain } from "../entities/types";
import { getDb } from "../firebase/getDb";
import { stableStringify } from "../utils/stableStringify";
import { buildFactId } from "./factId";
import { normalizeFactValueByLocale } from "./locale";
import { normalizeFactKey } from "./semantic";
import type { FactDoc, FactInput } from "./types";

function canonicalizeFactForNoop(doc: any) {
  if (!doc || typeof doc !== "object") return doc;

  // shallow clone
  const clone: any = { ...doc };

  // 1) Zeitstempel raus (klar)
  delete clone.createdAt;
  delete clone.updatedAt;

  // 2) Event-volatile Provenance raus:
  // sourceRef ist pro Ingest/Event unterschiedlich (z.B. rawEventId) -> darf NOOP nicht brechen
  delete clone.sourceRef;

  // 3) Meta bereinigen: alles raus, was event-gebunden ist
  if (clone.meta && typeof clone.meta === "object") {
    const m: any = { ...clone.meta };

    // typische volatile Felder (bei dir realistisch)
    delete m.rawEventId;
    delete m.sourceRef;
    delete m.duplicateOf;
    delete m.ingestedAt;
    delete m.runId;
    delete m.requestId;

    clone.meta = m;
  }

  return clone;
}

function factsCol(userId: string) {
  return getDb().collection("brain").doc(userId).collection("facts");
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

    // 1) Wir bauen erst alle FactDocs + refs, um existing einmalig zu laden
    const pending: { ref: FirebaseFirestore.DocumentReference; doc: FactDoc }[] = [];
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

      // Phase 2: FactStore resolved NICHT.
// Wenn entityId fehlt -> skip (keine Fingerprints, kein Resolver, kein Indexing).
if (!entityId) {
  skipped++;
  continue;
}

      const rawDomain = (f as any).domain ?? (f as any).entityDomain ?? "generic";
      const domain = toEntityDomain(rawDomain);
      const validityWindow = f.validity ?? undefined;

      // 3.7: Key normalisieren (Registry) â€“ VOR FactId/Conflict
      const key = normalizeFactKey(f.key, domain, f.meta);
      if (!key) {
        skipped++;
        continue;
      }

      // 3.6 Locale Layer (Default de-DE, wenn nicht gesetzt)
      const locale =
        f.meta && typeof f.meta === "object" && typeof (f.meta as any).locale === "string"
          ? String((f.meta as any).locale)
          : "de-DE";

      const normalizedValue = normalizeFactValueByLocale(f.value ?? null, locale);

      // FIX 3.9: latest
      const isLatest =
        !!(f.meta && typeof f.meta === "object" && (f.meta as any).latest === true);

      const sourceRef =
        typeof f.sourceRef === "string" && f.sourceRef.trim()
          ? f.sourceRef.trim()
          : "";

      // ðŸ”’ PHASE 1.1.1 latest-only contract (hart)
      if (isLatest) {
        if (!sourceRef) {
          skipped++;
          continue;
        }
        const metaObj = f.meta && typeof f.meta === "object" ? (f.meta as any) : null;
        if (!metaObj || metaObj.latest !== true) {
          skipped++;
          continue;
        }
      }

      const factId =
        typeof f.factId === "string" && f.factId.trim()
          ? f.factId.trim()
          : buildFactId({
    entityId: entityId,
    domain, // << NEU
    key,
    value: isLatest ? "__latest__" : normalizedValue,
    options: { validityWindow },
  });

      // ------------------------------------------------------------
// Evidence v1
// - latest:true  => EVIDENCE-ID STABIL (NICHT rawEventId-gebunden)
// - latest:false => EVIDENCE-ID pro sourceRef (rawEventId) ok
// ------------------------------------------------------------
if (sourceRef) {
  const isLatestEv =
    !!(f.meta && typeof f.meta === "object" && (f.meta as any).latest === true);

  const evidenceId = isLatestEv
    ? sha256Hex(`evidence|${factId}|latest`)     // stabil pro FactId
    : sha256Hex(`evidence|${factId}|${sourceRef}`); // legacy/pro-event

  const ev: EvidenceDoc = {
    evidenceId,
    factId,
    userId,
    entityId,
    domain,
    key,
    value: normalizedValue,
    source: f.source ?? "other",
    sourceRef,        // bei latest:true Ã¼berschreiben wir damit "zuletzt gesehen"
    createdAt: now,   // ok, weil merge:true; wenn du willst kann man createdAt stabilisieren, aber erstmal minimal
  };

  const evRef = evidenceCol(userId).doc(evidenceId);
  batch.set(evRef, ev, { merge: true });
  evidenceAttempted++;
}

      const conflict = f.conflict === true ? true : false;

      // Fact-Doc bauen (updatedAt setzen wir erst beim echten Write)
      const doc: FactDoc = {
        factId,
        entityId: entityId,
        domain,
        key,
        value: normalizedValue,
        isSuperseded: false,

        source: f.source ?? "other",
        conflict,

        // createdAt/updatedAt werden spÃ¤ter NOOP-sicher gesetzt
        createdAt: typeof f.createdAt === "number" ? f.createdAt : now,
        updatedAt: now,

        ...(typeof f.unit === "string" && f.unit.trim() ? { unit: f.unit.trim() } : {}),
        ...(typeof f.confidence === "number" ? { confidence: f.confidence } : {}),
        ...(f.validity !== undefined ? { validity: f.validity } : {}),
        ...(f.meta && typeof f.meta === "object" ? { meta: f.meta } : {}),
      };

      const ref = col.doc(factId);
      pending.push({ ref, doc });
    }

    // 2) Existing docs einmalig laden
    const existingById = new Map<string, any>();
    if (pending.length > 0) {
      const refs = pending.map((p) => p.ref);
      const snaps = await getDb().getAll(...refs);
      for (const s of snaps) {
        existingById.set(s.id, s.exists ? s.data() : null);
      }
    }

    // 3) NOOP-Check + Schreiben nur wenn geÃ¤ndert
    const writeNow = Date.now();
    for (const p of pending) {
      const prev = existingById.get(p.ref.id) ?? null;

      const nextDoc: FactDoc = {
        ...p.doc,
        // createdAt stabil halten, wenn Doc existiert
        createdAt: typeof prev?.createdAt === "number" ? prev.createdAt : p.doc.createdAt,
        // updatedAt nur relevant, wenn wir schreiben (ansonsten bleibt prev.updatedAt)
        updatedAt: writeNow,
      };

      const prevCanon = canonicalizeFactForNoop(prev);
      const nextCanon = canonicalizeFactForNoop(nextDoc);

      const same =
        !!prev && stableStringify(prevCanon) === stableStringify(nextCanon);

      if (same) {
        // NOOP: Fact nicht schreiben -> updatedAt bleibt stabil
        continue;
      }

      // Phase 1.1.2 minimal Supersede:
// Nur fÃ¼r NICHT-latest Facts (value-based IDs).
const isLatest =
  !!(nextDoc.meta && typeof nextDoc.meta === "object" && (nextDoc.meta as any).latest === true);

if (!isLatest) {
  const candSnap = await col
    .where("entityId", "==", nextDoc.entityId)
    .where("domain", "==", nextDoc.domain)
    .where("key", "==", nextDoc.key)
    .limit(50)
    .get();

  for (const d of candSnap.docs) {
    if (d.id === nextDoc.factId) continue;

    const data: any = d.data() || {};
    const already = data.isSuperseded === true;

    // Ã¤ltere Docs ohne isSuperseded gelten als aktiv
    if (!already) {
      batch.set(
        d.ref,
        {
          isSuperseded: true,
          supersededAt: writeNow,
          supersededByFactId: nextDoc.factId,
          updatedAt: writeNow,
        },
        { merge: true }
      );
    }
  }
}

batch.set(p.ref, nextDoc, { merge: true });
upserted++;
    }

    await batch.commit();
  }

  logger.info("factStore_upsertMany_done", { userId, upserted, skipped, evidenceAttempted });

  return { upserted, skipped, evidenceAttempted };
}

