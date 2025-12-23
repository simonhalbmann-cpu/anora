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

  const factsNewCount = out.factsDiff?.new?.length ?? 0;
  const hasHaltungPatch = hasAnyKeys(out.haltungDelta?.patch);

  const writePlan: CoreWritePlanV1 = {
    rawEvent: "none",
    facts: factsNewCount > 0 ? "upsert" : "none",
    haltung: hasHaltungPatch ? "patch" : "none",
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

  // Not implemented on purpose (Phase 6.3+)
  const persistence: PersistenceStatusV1 = {
    dryRun: false,
    wrote: false,
    reason: "not_implemented_yet",
  };

  return { ...out, persistence, writePlan };
}