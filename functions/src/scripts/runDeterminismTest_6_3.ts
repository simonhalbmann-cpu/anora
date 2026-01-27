// functions/src/scripts/runDeterminismTest_6_3.ts
/**
 * PHASE 6.3 – Determinism Regression Test
 *
 * Ziel:
 * - gleicher Input => bit-identischer Output
 * - inkl. Satellites (document-understanding)
 * - inkl. Tier (free / pro)
 * - inkl. Digest material
 *
 * HARD RULES:
 * - KEINE Writes
 * - KEIN Emulator-Zwang
 * - NUR runCoreOnce
 */

import assert from "assert";
import crypto from "crypto";
import { runCoreOnce } from "../core/runCoreOnce";
import { stableStringify } from "../core/utils/stableStringify";

/**
 * Hash helper – damit wir nicht nur === vergleichen,
 * sondern explizit beweisen, dass der Output identisch ist.
 */
function hashOut(out: any): string {
  const s = stableStringify(out);
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

async function runOnce(label: string, tier: "free" | "pro") {
  const input = {
    userId: "determinism-u",
    text: "Mietvertrag für Wohnung in Berlin. Kaltmiete 950 EUR.",
    extractorIds: [], // wichtig: keine Extractors → Fokus Satellite + Digest
    state: {
      locale: "de-DE",
      facts: [],
      tier,
      satelliteIds: ["document-understanding.v1"],
    },
  };

  const out1 = await runCoreOnce(input as any);
  const out2 = await runCoreOnce(input as any);

  const h1 = hashOut(out1);
  const h2 = hashOut(out2);

  // --- HARD ASSERTS ---

  // 1) Bitidentische Outputs
  assert.equal(
    h1,
    h2,
    `[${label}] NON-DETERMINISTIC: hash mismatch\n${h1}\n${h2}`
  );

  // 2) Satellites müssen gelaufen sein
  const ran = out1?.debug?.satellites?.ran;
  assert.ok(Array.isArray(ran), `[${label}] satellites.ran missing`);
  assert.ok(ran.length === 1, `[${label}] expected exactly 1 satellite run`);

  // 3) Digest contribution vorhanden (DATA ONLY)
  const digest = ran[0]?.digest_only;
  assert.ok(digest, `[${label}] digest_only missing`);
  assert.equal(digest.version, 1, `[${label}] digest version mismatch`);

  // 4) Bounded output (keine Explosion)
  const size = stableStringify(out1).length;
  assert.ok(size < 200_000, `[${label}] output too large: ${size}`);

  console.log(`✅ [${label}] determinism OK (hash=${h1.slice(0, 12)}…, size=${size})`);
}

async function main() {
  console.log("▶ PHASE 6.3 – Determinism Regression Test");

  await runOnce("FREE_TIER", "free");
  await runOnce("PRO_TIER", "pro");

  console.log("✅ PHASE 6.3 PASSED – Determinism + Satellites + Digest");
}

main().catch((e) => {
  console.error("❌ PHASE 6.3 FAILED", e);
  process.exit(1);
});