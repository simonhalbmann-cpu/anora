// functions/src/core/persistence/executeWritePlanV1.ts
// PHASE 6.3 – impure executor (the ONLY place that writes)

import type { RunCoreOnceOutput } from "../runCoreOnce";
import type { CoreWritePlanV1, PersistenceResultV1 } from "./types";

export let __EXECUTOR_CALLS__ = 0;
export function __resetExecutorCalls__() {
  __EXECUTOR_CALLS__ = 0;
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
  // Lazy import to keep core boundary obvious (still impure file)
  const { rawEventRef, factRef, haltungRef } = await import("./firestoreExecutorV1.js");

  // We write exactly what the plan allows. Nothing else.
  const batch = (await import("firebase-admin")).default.firestore().batch();

  let rawEventsAppended = 0;
  let factsUpserted = 0;
  let haltungPatched = 0;

  if (wantsRawEvent) {
    const { rawEventId, doc } = input.out.rawEvent;
    batch.set(rawEventRef(userId, rawEventId), doc, { merge: false });
    rawEventsAppended = 1;
  }

  if (wantsFacts) {
    // Upsert validated facts by deterministic factId
    for (const f of input.out.validatedFacts) {
      // Hard guard: only upsert facts that are actually NEW according to factsDiff
      if (!input.out.factsDiff.new.includes(f.factId)) continue;

      batch.set(
        factRef(userId, f.factId),
        {
          factId: f.factId,
          entityId: f.entityId,
          domain: f.domain,
          key: f.key,
          value: f.value,
          validity: f.validity ?? null,
          meta: f.meta ?? null,
          source: f.source ?? "raw_event",
          sourceRef: f.sourceRef ?? input.out.rawEvent.rawEventId,
          conflict: f.conflict ?? false,
          updatedAt: Date.now(),
          createdAt: Date.now(),
        },
        { merge: true }
      );
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