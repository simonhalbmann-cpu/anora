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

function countDigestContributions(out: any): number {
  const facts = Array.isArray(out?.validatedFacts) ? out.validatedFacts : [];

  for (const f of facts) {
    if (f?.key !== "doc:summary") continue;

    const extractorId = f?.meta?.extractorId;
    if (extractorId !== "document_understanding.v1") continue;

    // bounded: pro Run max 1 Contribution
    return 1;
  }

  return 0;
}

export async function runCoreWithPersistence(
  input: RunCoreWithPersistenceInput
): Promise<RunCoreWithPersistenceOutput> {
  const dryRun = input.dryRun !== false; // default true

  const out = await runCoreOnce(input);
  const digestContribCount = countDigestContributions(out);

  const extractorsOff =
    Array.isArray(input.extractorIds) && input.extractorIds.length === 0;

  // HARD CONTRACT: extractors OFF => out must behave as if no extractors ran
  if (extractorsOff) {
    // validatedFacts must be empty for Phase 2 golden test + contract clarity
    (out as any).validatedFacts = [];

    // optional: if runCoreOnce tracks extractor runs in `ran`, clear it too
    if (Array.isArray((out as any).ran)) {
      (out as any).ran = [];
    }

    // keep debug consistent with contract
    if (out && typeof (out as any).debug === "object" && (out as any).debug) {
      (out as any).debug.validatedFactsCount = 0;
      (out as any).debug.extractedFactsCount = 0;
    }
  }

  // ---------------------------------------------
  // CORE-CLARIFY (deterministisch, ohne LLM)
  // Wenn Core Konflikte entdeckt, erzwingen wir eine Rückfrage.
  // ---------------------------------------------
  const conflicts = Array.isArray((out as any).conflicts) ? (out as any).conflicts : [];

  if (!extractorsOff && !((out as any).clarify) && conflicts.length > 0) {
    const c = conflicts[0]; // deterministisch: immer erster Konflikt

    const entityId = String(c?.entityId ?? "").trim();
    const key = String(c?.key ?? "").trim();

    const userFactId = String(c?.userFactId ?? "").trim();
    const docFactId = String(c?.docFactId ?? "").trim();

    const userValue = c?.userValue;
    const docValue = c?.docValue;

    const vUser = typeof userValue === "string" ? userValue : JSON.stringify(userValue);
    const vDoc = typeof docValue === "string" ? docValue : JSON.stringify(docValue);

    (out as any).clarify = {
      entityId,
      key,
      question: `Ich habe zwei unterschiedliche Werte für "${key}". Welcher ist korrekt?`,
      choices: ["Kandidat 1", "Kandidat 2"],
      candidates: [
        { factId: userFactId || "user_claim", value: userValue },
        { factId: docFactId || "doc_fact", value: docValue },
      ],
    };

    // Optional: Debug-Warnung im Output (keine Side-Effects)
    (out as any).debug = (out as any).debug || {};
    (out as any).debug.coreClarifyReason = "conflict_events_present";
    (out as any).debug.coreClarifyCount = conflicts.length;
    (out as any).debug.coreClarifyPreview = { key, vUser, vDoc };
  }

// HARD CONTRACT: satellites OFF => NEVER plan fact writes
const factsPlannedCount = extractorsOff ? 0 : (out.validatedFacts?.length ?? 0);
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

  dailyDigest: {
  mode: digestContribCount > 0 ? "merge" : "none",
  count: digestContribCount,
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