// functions/src/scripts/runFactResolverAcceptance_8_2_duplicate.ts
//
// PHASE 8.2 — Duplicate Test (gleicher Score + gleiches Value)
// Erwartung:
// - KEIN needs_user
// - status = "resolved" (conflict=false)
//
// AUSFÜHRUNG:
// node .\lib\scripts\runFactResolverAcceptance_8_2_duplicate.js
//

import assert from "assert";
import { resolveCandidates } from "../core/facts/resolveCandidates";
import type { FactDoc } from "../core/facts/types";

const ENTITY_ID = "entity_phase_8_2_dup";
const KEY = "rent:cold";
const NOW = Date.now();

function fact(
  factId: string,
  sourceType: "email" | "expose",
  value: any,
  confidence: number
): FactDoc {
  return {
    factId,
    entityId: ENTITY_ID,
    key: KEY,
    domain: "real_estate",
    value,
    source: "raw_event",
    sourceRef: `${sourceType}_doc`,
    createdAt: NOW,
    updatedAt: NOW,
    meta: {
      sourceType,
      system: true,
      latest: true,
      confidence, // absichtlich gleich -> gleicher Score
      extractorId: `${sourceType}.v1`,
    },
  };
}

async function run() {
  console.log("PHASE 8.2 — Duplicate Test (same value)");

  const sameValue = { coldRent: 900 };

  const candidates: FactDoc[] = [
    fact("f_email", "email", sameValue, 0.7),
    fact("f_expose", "expose", sameValue, 0.7),
  ];

  const result = resolveCandidates(ENTITY_ID, KEY, candidates);

  console.log("RESULT:", JSON.stringify(result, null, 2));

  assert.ok(result.status !== "needs_user", "expected NOT needs_user for equal values");
  assert.ok(result.conflict === false, "expected conflict=false for equal values");
  assert.ok(result.status === "resolved", "expected status=resolved");

  console.log("✅ PASS: duplicate value does not require user decision");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ FAIL:", e);
    process.exit(1);
  });