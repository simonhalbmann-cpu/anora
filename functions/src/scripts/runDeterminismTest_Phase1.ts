// functions/src/scripts/runDeterminismTest_Phase1.ts
/**
 * PHASE 1 FINAL: Bitidentical determinism proof
 *
 * Goal:
 * - Two identical ingests produce bit-identical outputs (stableStringify equal)
 * - Cover both modes:
 *   A) extractorIds=["real_estate.v1"]  (satellites ON)
 *   B) extractorIds=[]                 (satellites OFF)
 *
 * This test is "HTTP-NAH" but without HTTP:
 * It runs runCoreWithPersistence(dryRun=true) directly.
 */

import assert from "assert";

// Side-effect: registers extractors into registry (required for listExtractors / getExtractor)
import "../core/facts/registryBootstrap";

import { runCoreWithPersistence } from "../core/runCoreWithPersistence";
import { stableStringify } from "../core/utils/stableStringify";

type AnyObj = Record<string, any>;

function pickDeterminismSurface(out: AnyObj): AnyObj {
  // We compare the entire output surface that matters for Phase 1.
  // Keep it explicit to avoid later "accidental" non-deterministic fields.
  return {
    rawEvent: out.rawEvent,
    validatedFacts: out.validatedFacts,
    factsDiff: out.factsDiff,
    factsChanges: out.factsChanges ?? null,
    haltungDelta: out.haltungDelta,
    intervention: out.intervention,
    effects: out.effects,
    writePlan: out.writePlan,
    persistence: out.persistence,
    debug: out.debug ?? null,
  };
}

function firstTopLevelDiffKey(a: AnyObj, b: AnyObj): string | null {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  for (const k of keys) {
    if (stableStringify(a[k]) !== stableStringify(b[k])) return k;
  }
  return null;
}

async function runCase(params: {
  name: string;
  userId: string;
  text: string;
  extractorIds: string[];
}) {
  const { name, userId, text, extractorIds } = params;

  const input = {
    userId,
    text,
    dryRun: true as const, // IMPORTANT: no writes; we only prove determinism
    extractorIds,
    state: {
      locale: "de-DE",
      facts: [],
      // haltung intentionally omitted to use deterministic defaults
    },
  };

  const out1 = await runCoreWithPersistence(input);
  const out2 = await runCoreWithPersistence(input);

  const s1 = pickDeterminismSurface(out1 as any);
  const s2 = pickDeterminismSurface(out2 as any);

  const j1 = stableStringify(s1);
  const j2 = stableStringify(s2);

  if (j1 !== j2) {
    const k = firstTopLevelDiffKey(s1, s2);
    console.error("❌ PHASE 1 DETERMINISM FAILED", {
      case: name,
      firstDiffTopLevelKey: k,
      out1: s1,
      out2: s2,
    });
    throw new Error(`PHASE 1 DETERMINISM FAILED (${name}) firstDiff=${k ?? "unknown"}`);
  }

  // Extra sanity: writePlan must exist and be stable
  assert.ok(out1.writePlan?.version === 1, "writePlan missing or version != 1");

  console.log(`✅ DETERMINISM OK: ${name}`, {
    rawEventId: out1.rawEvent?.rawEventId?.slice?.(0, 12) ?? null,
    facts: Array.isArray(out1.validatedFacts) ? out1.validatedFacts.length : null,
    writePlan: out1.writePlan,
    persistence: out1.persistence,
  });
}

async function main() {
  console.log("▶ PHASE 1 FINAL: Determinism (bitidentical) test");

  // Case A: Satellites ON (explicit extractor)
  await runCase({
    name: "A_ON_real_estate.v1",
    userId: "det-proof-user",
    text: "Wohnung in Berlin. Kaltmiete 900 EUR.",
    extractorIds: ["real_estate.v1"],
  });

  // Case B: Satellites OFF (no extractors)
  await runCase({
    name: "B_OFF_no_extractors",
    userId: "det-proof-user",
    text: "Wohnung in Berlin. Kaltmiete 900 EUR.",
    extractorIds: [],
  });

  console.log("✅ PHASE 1 FINAL: Determinism proof PASSED");
}

main().catch((e) => {
  console.error("❌ PHASE 1 FINAL: Determinism proof FAILED", e);
  process.exit(1);
});