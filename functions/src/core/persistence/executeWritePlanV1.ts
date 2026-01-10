// functions/src/core/persistence/executeWritePlanV1.ts
// PHASE 6.3 – impure executor (the ONLY place that writes)

import admin from "firebase-admin";
import type { RunCoreOnceOutput } from "../runCoreOnce";
import { sha256Hex } from "../utils/hash";
import { stableStringify } from "../utils/stableStringify";
import {
  evidenceRef,
  factHistoryRef,
  factRef,
  haltungRef,
  rawEventRef,
} from "./firestoreExecutorV1";
import type { CoreWritePlanV1, PersistenceResultV1 } from "./types";

export let __EXECUTOR_CALLS__ = 0;

export function __resetExecutorCalls__() {
  __EXECUTOR_CALLS__ = 0;
}

function canonicalizeFactDocForNoop(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;

 const {
  updatedAt,
  createdAt,

  // wichtig: sourceRef soll KEIN Update triggern
  sourceRef,

  ...rest
} = doc;

  return rest;
}

function buildEvidenceId(params: { factId: string; sourceRef: string }) {
  return sha256Hex(`evidence::${params.factId}::${params.sourceRef}`);
}

function buildHistoryId(params: {
  factId: string;
  sourceRef: string;
  kind: "created" | "updated" | "superseded";
}) {
  return sha256Hex(
    `history::${params.factId}::${params.sourceRef}::${params.kind}`
  );
}

// NOTE: This file is intentionally impure. It may import Firestore/admin later.
// For now we keep it minimal and do not implement actual writes until 6.3.3 wiring.

export type ExecuteWritePlanV1Input = {
  userId: string;
  out: RunCoreOnceOutput;       // contains rawEvent/doc, validatedFacts, haltungDelta
  plan: CoreWritePlanV1;
};

export async function executeWritePlanV1(
  input: ExecuteWritePlanV1Input
): Promise<PersistenceResultV1> {
  __EXECUTOR_CALLS__ += 1;

  const userId = String(input?.userId ?? "").trim();
  if (!userId) {
    return { wrote: false, reason: "failed", error: { message: "executeWritePlanV1: userId missing" } };
  }

  const plan = input.plan;

  const wantsRawEvent = plan.rawEvent === "append";
  const wantsFacts = plan.facts.mode === "upsert" && (plan.facts.count ?? 0) > 0;
  const wantsHaltung = plan.haltung.mode === "set_state" && (plan.haltung.keys?.length ?? 0) > 0;

  // Minimal noop fast-path
  if (!wantsRawEvent && !wantsFacts && !wantsHaltung) {
    return {
      wrote: false,
      reason: "noop",
      counts: {
  rawEventsAppended: 0,
  factsUpserted: 0,
  haltungPatched: 0,
  historyAppended: 0,
  evidenceAppended: 0,
},
    };
  }

  try {

  // We write exactly what the plan allows. Nothing else.
  const db = admin.firestore();
const batch = db.batch();

  let rawEventsAppended = 0;
  let factsUpserted = 0;
  let haltungPatched = 0;
  let historyAppended = 0;
  let evidenceAppended = 0;

  if (wantsRawEvent) {
  const { rawEventId, doc } = input.out.rawEvent;
  const ref = rawEventRef(userId, rawEventId);

  // Idempotenz: wenn rawEvent bereits existiert und identisch ist -> NICHT schreiben
  const snap = await ref.get();
  if (snap.exists) {
    const prev = snap.data();
    const same = stableStringify(prev) === stableStringify(doc);
    if (!same) {
      batch.set(ref, doc, { merge: false });
      rawEventsAppended = 1;
    }
  } else {
    batch.set(ref, doc, { merge: false });
    rawEventsAppended = 1;
  }
}

  if (wantsFacts) {
  // Upsert NUR für Facts, die laut factsDiff "new" sind
  const upserts = Array.isArray(input.out.validatedFacts)
  ? input.out.validatedFacts
  : [];

  // Preload existing docs once (NOOP / idempotency)
  const refs = upserts.map((f) => factRef(userId, String(f.factId)));
  const snaps = refs.length > 0 ? await db.getAll(...refs) : [];

  const existingById = new Map<string, any>();
  for (const s of snaps) {
    existingById.set(s.id, s.exists ? s.data() : null);
  }

  for (const f of upserts) {
    const factId = String(f.factId);
    const ref = factRef(userId, factId);

    const prev = existingById.get(factId) ?? null;
    const now = Date.now();

    // Base doc ohne volatile Felder
    const nextBase: any = {
      factId,
      entityId: f.entityId,
      domain: f.domain,
      key: f.key,
      value: f.value,
      validity: f.validity ?? null,
      meta: f.meta ?? null,
      source: f.source ?? "raw_event",
      sourceRef: f.sourceRef ?? input.out.rawEvent.rawEventId,
      conflict: !!f.conflict,

      // createdAt stabil halten wenn vorhanden
      createdAt: typeof prev?.createdAt === "number" ? prev.createdAt : now,
    };

    const prevCanon = canonicalizeFactDocForNoop(prev);
    const nextCanon = canonicalizeFactDocForNoop(nextBase);

    const same =
      !!prev && stableStringify(prevCanon) === stableStringify(nextCanon);

    if (same) {
      // ✅ NOOP: NICHT schreiben, updatedAt bleibt stabil
      continue;
    }

    // Nur wenn wir wirklich schreiben: updatedAt setzen
    const nextDoc = { ...nextBase, updatedAt: now };

// ✅ evId SOFORT berechnen (wir brauchen es für supersedes)
const evId = buildEvidenceId({ factId, sourceRef: String(nextDoc.sourceRef) });

// Fact schreiben
batch.set(ref, nextDoc, { merge: true });
factsUpserted += 1;

// ✅ Supersedes: wenn UPDATE, dann alte Evidence markieren
if (prev && typeof (prev as any)?.sourceRef === "string" && String((prev as any).sourceRef).trim()) {
  const prevEvId = buildEvidenceId({ factId, sourceRef: String((prev as any).sourceRef) });

  // Nur superseden, wenn es wirklich eine andere Evidence ist
  if (prevEvId !== evId) {
    batch.set(
      evidenceRef(userId, prevEvId),
      {
        supersededBy: evId,
        supersededAt: now,
      },
      { merge: true }
    );
  }
}

// Neue Evidence schreiben
batch.set(
  evidenceRef(userId, evId),
  {
    evidenceId: evId,
    factId,
    entityId: nextDoc.entityId,
    domain: nextDoc.domain,
    key: nextDoc.key,
    sourceRef: nextDoc.sourceRef,
    rawEventId: input.out.rawEvent.rawEventId,
    createdAt: now,

    // optional aber sauber:
    supersededBy: null,
    supersededAt: null,
  },
  { merge: false }
);

evidenceAppended += 1;

const isUpdate = !!prev;

// 1) Wenn Update: schreibe ein "superseded"-History-Event für den alten Stand
if (isUpdate) {
  const prevSourceRef = String((prev as any)?.sourceRef ?? "").trim();

  // prevSourceRef sollte da sein (bei dir ist sourceRef normalerweise rawEventId),
  // aber wir sind defensiv und schreiben superseded nur wenn vorhanden.
  if (prevSourceRef) {
    const supersededHistoryId = buildHistoryId({
      factId,
      sourceRef: prevSourceRef,
      kind: "superseded",
    });

    batch.set(
      factHistoryRef(userId, supersededHistoryId),
      {
        historyId: supersededHistoryId,
        factId,
        entityId: nextDoc.entityId,
        domain: nextDoc.domain,
        key: nextDoc.key,
        kind: "superseded",
        prev: canonicalizeFactDocForNoop(prev),
        next: null,
        sourceRef: prevSourceRef,
        supersededBySourceRef: nextDoc.sourceRef,
        createdAt: now,
      },
      { merge: false }
    );

    historyAppended += 1;
  }
}

// 2) Immer: "created" oder "updated"-History-Event für den neuen Stand
const kind: "created" | "updated" = isUpdate ? "updated" : "created";

const historyId = buildHistoryId({
  factId,
  sourceRef: String(nextDoc.sourceRef),
  kind,
});

batch.set(
  factHistoryRef(userId, historyId),
  {
    historyId,
    factId,
    entityId: nextDoc.entityId,
    domain: nextDoc.domain,
    key: nextDoc.key,
    kind,
    prev: isUpdate ? canonicalizeFactDocForNoop(prev) : null,
    next: canonicalizeFactDocForNoop(nextDoc),
    sourceRef: nextDoc.sourceRef,
    createdAt: now,
  },
  { merge: false }
);

historyAppended += 1;


    
  }
}

  if (wantsHaltung) {
  const now = Date.now();

  // Wir schreiben den *vollen* Zustand (State), nicht nur den Patch.
  // Der State kommt aus dem Pure Core (`haltungDelta.after`), basierend auf `state.haltung`.
  batch.set(
    haltungRef(userId),
    {
      ...input.out.haltungDelta.after,
      updatedAt: now, // Storage-Timestamp darf impure sein
    },
    { merge: false } // State-Doc ist "single source of truth"
  );

  haltungPatched = 1;
}

const totalWrites =
  rawEventsAppended +
  factsUpserted +
  haltungPatched +
  historyAppended +
  evidenceAppended;

if (totalWrites === 0) {
  return {
    wrote: false,
    reason: "noop",
    counts: {
      rawEventsAppended: 0,
      factsUpserted: 0,
      haltungPatched: 0,
      historyAppended: 0,
      evidenceAppended: 0,
    },
  };
}

  await batch.commit();

  return {
    wrote: true,
    reason: "executed",
    counts: {
  rawEventsAppended,
  factsUpserted,
  haltungPatched,
  historyAppended,
  evidenceAppended,
},
  };
} catch (e: any) {
  return {
    wrote: false,
    reason: "failed",
    error: { message: String(e?.message ?? e) },
  };
}
}