/**
 * PHASE 6.1 — Zeit-Test
 * - 100 Interaktionen
 * - keine neuen Facts (extractorIds = [])
 * - deterministisch: gleicher Ablauf => gleicher Trace-Hash
 * - Haltung lernt nur bei expliziten Commands
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

function pickMsg(i: number): string {
  if (i === 20) return "Sei direkter.";
  if (i === 40) return "Bitte kürzer.";
  if (i === 60) return "Das hat geholfen.";
  if (i === 80) return "Zu hart.";
  return `Ping ${i}: Ich will X tun, klingt das sinnvoll?`;
}

async function runSequence(label: string) {
  const userId = "u1";

  let state: any = {
    locale: "de-DE",
    facts: [],
    haltung: undefined,
  };

  const trace: TraceRow[] = [];

  for (let i = 1; i <= 100; i++) {
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
      facts: Array.isArray(state.facts) ? state.facts : [],
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
  const finalHaltung = trace[trace.length - 1]?.haltungAfter ?? null;

  return { hash, finalHaltung, traceCount: trace.length };
}

async function main() {
  const a = await runSequence("A");
  console.log("A hash:", a.hash);

  const b = await runSequence("B");
  console.log("B hash:", b.hash);

  if (a.hash !== b.hash) {
    throw new Error(`DETERMINISM FAIL: hash A != hash B`);
  }

  console.log("✅ PHASE 6.1 Zeit-Test PASSED (deterministisch, keine Facts, 100 Interaktionen).");
}

main().catch((e) => {
  console.error("❌ PHASE 6.1 Zeit-Test FAILED:", String(e));
  process.exit(1);
});
