// functions/src/scripts/runPhase6_1_GateTests.ts
import { strict as assert } from "assert";

import {
    gateDailyDigestPlan,
    type UserTier,
} from "../core/satellites/document-understanding/limits/freeProGates";

function testGate(tier: UserTier | any, expectedAllowed: boolean, expectedReason: string) {
  const out = gateDailyDigestPlan({ tier });

  assert.equal(out.allowed, expectedAllowed, `allowed mismatch for tier=${tier}`);
  assert.equal(out.reasonCode, expectedReason, `reasonCode mismatch for tier=${tier}`);

  // Determinismus: gleicher Input → gleicher Output
  const out2 = gateDailyDigestPlan({ tier });
  assert.deepEqual(out2, out, `non-deterministic output for tier=${tier}`);
}

function main() {
  // PRO
  testGate("pro", true, "tier_pro_allowed");

  // FREE
  testGate("free", false, "tier_free_blocked");

  // UNKNOWN / INVALID
  testGate(undefined, false, "tier_unknown_blocked");
  testGate("enterprise", false, "tier_unknown_blocked");

  console.log("✅ Phase 6.1 GateTests PASSED");
}

main();