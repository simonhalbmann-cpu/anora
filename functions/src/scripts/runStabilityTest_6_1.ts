// functions/src/scripts/runStabilityTest_6_1.ts
/**
 * Phase 6.1 – STABILITÄTSTEST (PURE)
 * 2 Modi:
 * - Mode A: extractorIds=[] (keine Extractors) -> Facts bleiben leer, nur Haltung/Intervention
 * - Mode B: Extractors default an, aber state.facts bleibt konstant -> factsDiff.new muss 0 bleiben
 *
 * WICHTIG:
 * - Kein Firestore
 * - Keine Writes
 * - Keine Seeds
 */


import crypto from "crypto";
import { runCoreWithPersistence } from "../core/bridgePure";

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function jsonStable(x: any) {
  return JSON.stringify(x ?? null);
}

type Mode = "A_OFF" | "B_ON_FROZEN";

async function runMode(mode: Mode) {
  const USER_ID = `stability_test_user_6_1_${mode}`;
  const LOCALE = "de-DE";

  const state = {
    locale: LOCALE,
    facts: [] as {
      factId: string;
      entityId: string;
      domain: string;
      key: string;
      value: any;
      validity?: { from?: number; to?: number };
      meta?: Record<string, any>;
    }[],
    haltung: undefined,
  };

  const prompts: string[] = [];
  for (let i = 0; i < 100; i++) {
    prompts.push(
      i % 5 === 0
        ? "Merke dir: Die Kaltmiete beträgt 1200 Euro."
        : "Wie hoch ist meine Kaltmiete nochmal?"
    );
  }

  const interventionLevels: string[] = [];
  const haltungSnapshots: any[] = [];
  const outputHashes: string[] = [];

  // HARD determinism: gleicher Text => gleicher Output-Hash
const seenByText = new Map<string, string>();

// Debug store: damit wir bei Hash-Diff die beiden Outputs vergleichen können
(globalThis as any).__outs = [];

  for (let i = 0; i < prompts.length; i++) {
    const text = prompts[i];

    const out = await runCoreWithPersistence({
  userId: USER_ID,
  text,
  state,
  extractorIds: mode === "A_OFF" ? [] : undefined,
  dryRun: true,
});

(globalThis as any).__outs[i] = out;


assert(
  out.persistence?.dryRun === true,
  `[${mode}] persistence.dryRun expected true`
);

assert(
  out.persistence?.wrote === false,
  `[${mode}] persistence.wrote expected false`
);
    // Kernassert: keine neuen Facts relativ zum konstanten Snapshot
    assert(
      Array.isArray(out.factsDiff.new) && out.factsDiff.new.length === 0,
      `[${mode}] factsDiff.new not empty at step ${i} (count=${out.factsDiff.new?.length ?? "?"})`
    );

    // Phase 6.3: writePlan must stay frozen (no persistence writes planned)
assert(
  out?.writePlan?.facts === "none",
  `[${mode}] writePlan.facts expected "none" at step ${i}, got=${String(out?.writePlan?.facts)}`
);

assert(
  out?.writePlan?.haltung === "none",
  `[${mode}] writePlan.haltung expected "none" at step ${i}, got=${String(out?.writePlan?.haltung)}`
);

assert(
  out?.writePlan?.rawEvent === "none",
  `[${mode}] writePlan.rawEvent expected false at step ${i}, got=${String(out?.writePlan?.rawEvent)}`
);

    // Phase 6.3.5: determinism HARD (same text => bit-identical output)
const h = sha256Hex(jsonStable(out));
outputHashes.push(h);

const prev = seenByText.get(text);
if (prev) {
  assert(
    prev === h,
    `[${mode}] NON-DETERMINISTIC for same text at step ${i}: prev=${prev} now=${h}`
  );
} else {
  seenByText.set(text, h);
}
    interventionLevels.push(String(out?.intervention?.level ?? "none"));
    haltungSnapshots.push(out?.haltungDelta?.after ?? null);

    if (i % 10 === 0) {
      console.log(
        `[${mode} ${i}] level=${out?.intervention?.level} newFacts=${out.factsDiff.new.length} ignored=${out.factsDiff.ignored.length}`
      );
    }
  }

  const tail = haltungSnapshots.slice(-20).map(jsonStable);
  const uniqueTail = new Set(tail);
  assert(
    uniqueTail.size <= 2,
    `[${mode}] haltung not stable in tail (uniqueTail=${uniqueTail.size})`
  );

  return {
    mode,
    uniqueHaltungTail: uniqueTail.size,
    interventionLevelTail: interventionLevels.slice(-20),
  };
}

async function main() {
  const resA = await runMode("A_OFF");
  console.log("✅ MODE A PASSED", resA);

  const resB = await runMode("B_ON_FROZEN");
  console.log("✅ MODE B PASSED", resB);

  console.log("✅ PHASE 6.1 PASSED (A+B)");
}

main().catch((e) => {
  console.error("❌ PHASE 6.1 FAILED", e);
  process.exit(1);
});