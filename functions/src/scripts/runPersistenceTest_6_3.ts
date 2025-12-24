// functions/src/scripts/runPersistenceTest_6_3.ts
import { strict as assert } from "assert";

import { runCoreWithPersistence } from "../core/bridgePure";
import { __EXECUTOR_CALLS__, __resetExecutorCalls__ } from "../core/persistence/executeWritePlanV1";

async function main() {
  __resetExecutorCalls__();

  // 1) dryRun=true (default): executor must NOT be called
  const out1 = await runCoreWithPersistence({
    userId: "u_test",
    text: "hello",
    extractorIds: [], // deterministic: no facts
    // dryRun omitted -> true
  });

  assert.equal(out1.persistence.dryRun, true);
  assert.equal(out1.persistence.wrote, false);
  assert.equal(out1.persistence.reason, "dry_run");
  assert.equal(__EXECUTOR_CALLS__, 0, "executor must NOT be called in dryRun=true");

  // 2) dryRun=false: executor MUST be called exactly once
  const out2 = await runCoreWithPersistence({
    userId: "u_test",
    text: "hello",
    extractorIds: [],
    dryRun: false,
  });

  assert.equal(out2.persistence.dryRun, false);
  assert.equal(__EXECUTOR_CALLS__, 1, "executor must be called exactly once in dryRun=false");

  console.log("✅ PERSISTENCE TEST 6.3 PASSED (dryRun gating works)");
}

main().catch((e) => {
  console.error("❌ PERSISTENCE TEST 6.3 FAILED", e);
  process.exit(1);
});
