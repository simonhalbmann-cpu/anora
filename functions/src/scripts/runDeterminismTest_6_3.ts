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
import fs from "fs";
import path from "path";
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
  now: 1700000000000,
},
  };

  const out1 = await runCoreOnce(input as any);
  const out2 = await runCoreOnce(input as any);

  const s1 = stableStringify(out1);
  const s2 = stableStringify(out2);

  const dir = path.join(process.cwd(), "_debug_determinism");
  fs.mkdirSync(dir, { recursive: true });

  const p1 = path.join(dir, `${label}_1.json`);
  const p2 = path.join(dir, `${label}_2.json`);

  fs.writeFileSync(p1, s1, "utf8");
  fs.writeFileSync(p2, s2, "utf8");

  console.log(`[${label}] wrote:`, p1, p2);
  console.log(`[${label}] len1/len2:`, s1.length, s2.length);

  const h1 = hashOut(out1);
  const h2 = hashOut(out2);

  // --- HARD ASSERTS ---

  // 1) Bitidentische Outputs
  assert.equal(
    h1,
    h2,
    `[${label}] NON-DETERMINISTIC: hash mismatch\n${h1}\n${h2}`
  );

  // 2) Extractors sind AUS → es darf KEINE validatedFacts geben
  assert.ok(
    Array.isArray(out1?.validatedFacts),
    `[${label}] validatedFacts missing`
  );
  assert.equal(
    out1.validatedFacts.length,
    0,
    `[${label}] expected validatedFacts to be empty when extractorIds=[]`
  );

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