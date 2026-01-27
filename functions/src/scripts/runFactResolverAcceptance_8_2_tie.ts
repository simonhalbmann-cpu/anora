// PHASE 8.2 — Akzeptanztest: Tie => needs_user
//
// Erwartung:
// - zwei Facts mit gleichem Score
// - Resolver darf NICHT entscheiden
// - status = needs_user
//
// AUSFÜHRUNG:
// node .\lib\scripts\runFactResolverAcceptance_8_2_tie.js

import assert from "assert";
import { resolveCandidates } from "../core/facts/resolveCandidates";
import type { FactDoc } from "../core/facts/types";

const ENTITY_ID = "entity_phase_8_2";
const KEY = "rent:cold";
const NOW = Date.now();

function fact(
  factId: string,
  sourceType: "email" | "expose",
  value: any
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
      confidence: 0.7, // IDENTISCHER SCORE
      extractorId: `${sourceType}.v1`,
    },
  };
}

function run() {
  console.log("PHASE 8.2 — Tie Test");

  const candidates: FactDoc[] = [
    fact("f_email", "email", { coldRent: 900 }),
    fact("f_expose", "expose", { coldRent: 950 }),
  ];

  const result = resolveCandidates(ENTITY_ID, KEY, candidates);

  console.log("RESULT:", JSON.stringify(result, null, 2));

  assert.ok(result.status === "needs_user", "expected needs_user");
  assert.ok(result.tie === true, "expected tie=true");

  console.log("✅ PASS: tie correctly requires user decision");
}

run();