// functions/src/core/runCoreWithPersistence.ts
/**
 * PHASE 6.2 – Minimal Wrapper for future persistence
 * - Calls pure runCoreOnce
 * - Does NOT write anything yet
 * - dryRun defaults to true
 *
 * IMPORTANT:
 * - No Firestore imports here (yet)
 * - No side effects
 */

import { executeWritePlanV1 } from "./persistence/executeWritePlanV1";
import type { CoreWritePlanV1, PersistenceStatusV1 } from "./persistence/types";
import type { RunCoreOnceInput, RunCoreOnceOutput } from "./runCoreOnce";
import { runCoreOnce } from "./runCoreOnce";

function hasAnyKeys(obj: any): boolean {
  return !!obj && typeof obj === "object" && Object.keys(obj).length > 0;
}

export type RunCoreWithPersistenceInput = RunCoreOnceInput & {
  dryRun?: boolean; // default true
};

export type RunCoreWithPersistenceOutput = RunCoreOnceOutput & {
  persistence: PersistenceStatusV1;
  writePlan: CoreWritePlanV1;
};

export async function runCoreWithPersistence(
  input: RunCoreWithPersistenceInput
): Promise<RunCoreWithPersistenceOutput> {
  const dryRun = input.dryRun !== false; // default true

  const out = await runCoreOnce(input);

  const satellitesOff =
  Array.isArray(input.extractorIds) && input.extractorIds.length === 0;

// HARD CONTRACT: satellites OFF => NEVER plan fact writes
const factsPlannedCount = satellitesOff ? 0 : (out.validatedFacts?.length ?? 0);
  const hasHaltungPatch = hasAnyKeys(out.haltungDelta?.patch);

  const writePlan: CoreWritePlanV1 = {
  version: 1,

  rawEvent: "append",

  facts: {
  mode: factsPlannedCount > 0 ? "upsert" : "none",
  count: factsPlannedCount,
},

  haltung: {
  mode: hasHaltungPatch ? "set_state" : "none",
  keys: hasHaltungPatch ? Object.keys(out.haltungDelta.patch) : [],
},
};

  // Phase 6.2: persistence is still frozen
  if (dryRun) {
    const persistence: PersistenceStatusV1 = {
      dryRun: true,
      wrote: false,
      reason: "dry_run",
    };

    return { ...out, persistence, writePlan };
  }

  const res = await executeWritePlanV1({
  userId: String(input.userId),
  out,
  plan: writePlan,
});

if (res.reason === "noop") {
  const persistence: PersistenceStatusV1 = {
    dryRun: false,
    wrote: false,
    reason: "noop",
    counts: res.counts,
  };
  return { ...out, persistence, writePlan };
}

if (res.reason === "executed") {
  const persistence: PersistenceStatusV1 = {
    dryRun: false,
    wrote: true,
    reason: "executed",
    counts: res.counts,
  };
  return { ...out, persistence, writePlan };
}

// failed
const persistence: PersistenceStatusV1 = {
  dryRun: false,
  wrote: false,
  reason: "failed",
  error: res.error,
};
return { ...out, persistence, writePlan };
}