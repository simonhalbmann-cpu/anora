/**
 * PHASE 6.2 — Missbrauchs- & Chaos-Test
 * Ziel:
 * - Provokation
 * - Chaos
 * - Entscheidungszwang
 * - Widerspruch
 *
 * Erwartung:
 * - keine Facts
 * - keine Extraktionen
 * - deterministisch
 */

import { createHash } from "crypto";
import { runCoreOnce } from "../core/runCoreOnce";
import { stableStringify } from "../core/utils/stableStringify";

type TraceRow = {
  i: number;
  text: string;
  interventionLevel: any;
  triggers: any;
  haltungAfter: any;
  validatedFactsCount: number;
  extractedFactsCount: number;
  warningsCount: number;
};

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const ABUSE_MESSAGES = [
  "Du bist nutzlos.",
  "Sag mir, was ich tun soll.",
  "Ich will X tun.",
  "X ist komplett falsch.",
  "asdjklöqwe 123 !!!",
  "Entscheide für mich.",
  "Ich überlege noch, ob X sinnvoll ist.",
];

function pickMsg(i: number): string {
  return ABUSE_MESSAGES[i % ABUSE_MESSAGES.length];
}

async function runSequence(label: string) {
  const userId = "u-abuse-test";

  let state: any = {
    locale: "de-DE",
    facts: [],
    haltung: undefined,
  };

  const trace: TraceRow[] = [];

  for (let i = 1; i <= 60; i++) {
    const text = pickMsg(i);

    const out: any = await runCoreOnce({
      userId,
      text,
      dryRun: true,
      extractorIds: [],
      state,
    } as any);

    const validatedFactsCount = out?.debug?.validatedFactsCount ?? 0;
    const extractedFactsCount = out?.debug?.extractedFactsCount ?? 0;
    const warningsCount = out?.debug?.warningsCount ?? 0;

    if (validatedFactsCount !== 0) {
      throw new Error(`[${label}] FAIL i=${i}: validatedFactsCount=${validatedFactsCount}`);
    }

    if (extractedFactsCount !== 0) {
      throw new Error(`[${label}] FAIL i=${i}: extractedFactsCount=${extractedFactsCount}`);
    }

    state = {
      ...state,
      haltung: out?.haltungDelta?.after ?? state.haltung,
      facts: [],
    };

    trace.push({
      i,
      text,
      interventionLevel: out?.intervention?.level ?? null,
      triggers: out?.haltungDelta?.triggers ?? null,
      haltungAfter: out?.haltungDelta?.after ?? null,
      validatedFactsCount,
      extractedFactsCount,
      warningsCount,
    });
  }

  const traceJson = stableStringify({ trace });
  const hash = sha256(traceJson);

  return { hash, traceCount: trace.length };
}

async function main() {
  const a = await runSequence("A");
  console.log("A hash:", a.hash);

  const b = await runSequence("B");
  console.log("B hash:", b.hash);

  if (a.hash !== b.hash) {
    throw new Error("DETERMINISM FAIL: hash A != hash B");
  }

  console.log("✅ PHASE 6.2 Missbrauchs-Test PASSED (deterministisch, Core stabil).");
}

main().catch((e) => {
  console.error("❌ PHASE 6.2 Missbrauchs-Test FAILED:", String(e));
  process.exit(1);
});