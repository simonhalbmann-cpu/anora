// functions/src/scripts/runCoreContractTest_A5_2.ts
import assert from "assert";
import { FROZEN } from "../core/CORE_FREEZE";
import { listExtractors } from "../core/facts/registry";
import "../core/facts/registryBootstrap"; // ensures extractor registry is populated
import { normalizeFactKey } from "../core/facts/semantic";
import { runCoreOnce } from "../core/runCoreOnce";
import { runCoreWithPersistence } from "../core/runCoreWithPersistence";

async function main() {
  console.log("▶ A5.2 Core Contract Test");

  // 1) CORE_FREEZE basics
  assert.ok(Array.isArray(FROZEN.factKeys) && FROZEN.factKeys.length > 0, "FROZEN.factKeys empty");
  assert.ok(Array.isArray(FROZEN.domains) && FROZEN.domains.length > 0, "FROZEN.domains empty");
  assert.ok(Array.isArray(FROZEN.extractors) && FROZEN.extractors.length > 0, "FROZEN.extractors empty");

  // 2) Extractor registry respects freeze (registryBootstrap registered only allowed ones)
  const ex = listExtractors();
  assert.ok(ex.includes("real_estate.v1"), "expected real_estate.v1 registered");
  for (const id of ex) {
    assert.ok(FROZEN.extractors.includes(id as any), `registered extractor not frozen: ${id}`);
  }

  // 3) normalizeFactKey blocks illegal keys (your freeze-neg already proves this; we keep a fast unit)
  let threw = false;
  try {
    normalizeFactKey("illegal_new_key", "real_estate" as any, {});
  } catch {
    threw = true;
  }
  assert.ok(threw, "normalizeFactKey must throw on illegal_new_key under CORE_FREEZE");

  // 4) runCoreOnce determinism (same input => bit-identical out)
  const input = {
    userId: "contract-u",
    text: "Wohnung in Berlin. Kaltmiete 900 EUR.",
    extractorIds: ["real_estate.v1"],
    state: { locale: "de-DE", facts: [] as any[] },
  };

  const out1 = await runCoreOnce(input as any);
  const out2 = await runCoreOnce(input as any);
  assert.equal(JSON.stringify(out1), JSON.stringify(out2), "runCoreOnce not deterministic");

  // 5) runCoreWithPersistence write gating: dryRun must never write
  const p1 = await runCoreWithPersistence({
    userId: "contract-u2",
    text: "hello",
    extractorIds: [],
    dryRun: true,
    state: { locale: "de-DE", facts: [] },
  });
  assert.equal(p1.persistence.dryRun, true);
  assert.equal(p1.persistence.wrote, false);
  assert.equal(p1.persistence.reason, "dry_run");

  console.log("✅ A5.2 Core Contract Test PASSED");
}

main().catch((e) => {
  console.error("❌ A5.2 Core Contract Test FAILED", e);
  process.exit(1);
});