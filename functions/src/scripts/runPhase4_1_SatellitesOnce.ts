// functions/src/scripts/runPhase4_1_SatellitesOnce.ts

import { runCoreOnce } from "../core/runCoreOnce";


async function main() {
  
  const userId = "debug-user";
  const text =
    "Mietvertrag: Die Kaltmiete beträgt 1200 EUR. Der Mieter ist Max Mustermann. Frist: 31.12.2025.";

// Test-Tier toggeln
  const testTier: "free" | "pro" = "free"; // <- hier auf "free" oder "pro" stellen

  const out = await runCoreOnce({
    userId,
    text,
    extractorIds: [], // Extractors AUS
    state: {
      locale: "de-DE",
      facts: [],
      tier: testTier, // <-- HIER wird es reingereicht
    },
  });

  const validated = Array.isArray(out.validatedFacts) ? out.validatedFacts : [];

  const proposedDocSummary = validated.filter((f) => f.key === "doc:summary");

  console.log("=== Phase 4.1 Satellite Test ===");
  console.log("validatedFactsCount:", validated.length);
  console.log("doc:summary count:", proposedDocSummary.length);
  console.log("factsDiff:", out.factsDiff);
  console.log("warningsCount:", out.debug?.warningsCount);
  console.log("perExtractor:", out.debug?.perExtractor);
  console.log("sample doc:summary:", proposedDocSummary[0] ?? null);
  console.log("warnings:", JSON.stringify(out?.debug?.warningsCount ?? null, null, 2));
} // <-- DIESE KLAMMER HAT IN DEINER VERSION GEFEHLT

main().catch((e) => {
  console.error("runPhase4_1_SatellitesOnce failed:", e);
  process.exit(1);
});