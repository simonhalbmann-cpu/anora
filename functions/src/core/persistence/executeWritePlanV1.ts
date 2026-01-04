// functions/src/core/persistence/executeWritePlanV1.ts
// PHASE 6.3 – impure executor (the ONLY place that writes)

import admin from "firebase-admin";
import type { RunCoreOnceOutput } from "../runCoreOnce";
import { stableStringify } from "../utils/stableStringify";
import type { CoreWritePlanV1, PersistenceResultV1 } from "./types";

export let __EXECUTOR_CALLS__ = 0;
export function __resetExecutorCalls__() {
  __EXECUTOR_CALLS__ = 0;
}
function canonicalizeFactDocForNoop(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;

  const {
    // volatile fields: raus für NOOP-Vergleich
    updatedAt,
    createdAt,

    // Rest bleibt
    ...rest
  } = doc;

  return rest;
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
  const wantsHaltung = plan.haltung.mode === "patch" && (plan.haltung.keys?.length ?? 0) > 0;

  // Minimal noop fast-path
  if (!wantsRawEvent && !wantsFacts && !wantsHaltung) {
    return {
      wrote: false,
      reason: "noop",
      counts: { rawEventsAppended: 0, factsUpserted: 0, haltungPatched: 0 },
    };
  }

  try {

// CJS-safe lazy load (ts-node + tsc output)
const { rawEventRef, factRef, haltungRef } = require("./firestoreExecutorV1");

  // We write exactly what the plan allows. Nothing else.
  const db = admin.firestore();
const batch = db.batch();

  let rawEventsAppended = 0;
  let factsUpserted = 0;
  let haltungPatched = 0;

  if (wantsRawEvent) {
    const { rawEventId, doc } = input.out.rawEvent;
    batch.set(rawEventRef(userId, rawEventId), doc, { merge: false });
    rawEventsAppended = 1;
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

    batch.set(ref, nextDoc, { merge: true });
    factsUpserted += 1;
  }
}

  if (wantsHaltung) {
    batch.set(
      haltungRef(userId),
      {
        version: 1,
        patch: input.out.haltungDelta.patch,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    haltungPatched = 1;
  }

  await batch.commit();

  return {
    wrote: true,
    reason: "executed",
    counts: { rawEventsAppended, factsUpserted, haltungPatched },
  };
} catch (e: any) {
  return {
    wrote: false,
    reason: "failed",
    error: { message: String(e?.message ?? e) },
  };
}
}