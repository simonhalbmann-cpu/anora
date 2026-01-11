// functions/src/scripts/runPhase4_1_SatellitesOnce.ts

import { runCoreOnce } from "../core/runCoreOnce";
import { bootstrapSatellites } from "../core/satellites/registryBootstrap";

async function main() {
  // ✅ Registry bootstrappen (WICHTIG!)
  bootstrapSatellites();

  const userId = "debug-user";
  const text =
    "Mietvertrag: Die Kaltmiete beträgt 1200 EUR. Der Mieter ist Max Mustermann. Frist: 31.12.2025.";

// Test-Tier toggeln
  const testTier: "free" | "pro" = "pro"; // <- hier auf "free" oder "pro" stellen

  const out = await runCoreOnce({
    userId,
    text,
    extractorIds: [], // Extractors AUS
    state: {
      locale: "de-DE",
      facts: [],
      satelliteIds: ["document-understanding.v1"],
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

  console.log(
    "satellites debug:",
    JSON.stringify(out?.debug?.satellites ?? null, null, 2)
  );

  // ----------------------------
// NEW: digest_plan_gate aus runCoreOnce debug ziehen
// (runCoreOnce speichert hier KEIN komplettes SatelliteOutput, sondern nur Summary + digest_plan_gate)
// ----------------------------
const ran = Array.isArray((out as any)?.debug?.satellites?.ran)
  ? (out as any).debug.satellites.ran
  : [];

const du = ran.find((s: any) => s?.satelliteId === "document-understanding.v1") ?? null;

const digestGate = du?.digest_plan_gate ?? null;

console.log("digest_plan_gate:", JSON.stringify(digestGate, null, 2));

  console.log(
    "warnings:",
    JSON.stringify(out?.debug?.warningsCount ?? null, null, 2)
  );
} // <-- DIESE KLAMMER HAT IN DEINER VERSION GEFEHLT

main().catch((e) => {
  console.error("runPhase4_1_SatellitesOnce failed:", e);
  process.exit(1);
});