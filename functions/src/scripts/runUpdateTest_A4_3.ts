// functions/src/scripts/runUpdateTest_A4_3.ts
import { strict as assert } from "assert";
import "../core/facts/registryBootstrap";
import { runCoreOnce } from "../core/runCoreOnce";

async function main() {
  const userId = "u_update_a4_3";
  const baseText = "Ich bin Vermieter in Berlin. Adresse: Musterstraße 1.";

  // 1) Run #1: rent_cold=1200
  const out1 = await runCoreOnce({
    userId,
    text: baseText + " Kaltmiete 1200 Euro.",
    // Wichtig: Extractor ON (default), also extractorIds NICHT setzen
  });

  // Es sollte überhaupt Facts geben
  assert.ok(out1.validatedFacts.length > 0, "expected validatedFacts > 0");

  // Wir suchen den rent_cold Fact (latest)
  const f1 = out1.validatedFacts.find((f) => f.key === "rent_cold");
  assert.ok(f1, "expected rent_cold fact in run #1");
  assert.equal(f1.meta?.latest, true, "expected rent_cold meta.latest=true");

  // Beim ersten Run ohne state.facts muss es NEW sein
  assert.ok(
    out1.factsDiff.new.includes(f1.factId),
    "expected rent_cold factId to be in factsDiff.new on run #1"
  );

  // 2) Run #2: rent_cold=900 (same entity+key => same latest factId)
  // Wir geben die Facts aus Run #1 als state rein (PURE)
  const out2 = await runCoreOnce({
    userId,
    text: baseText + " Kaltmiete 900 Euro.",
    state: {
      locale: "de-DE",
      facts: out1.validatedFacts.map((vf) => ({
        factId: vf.factId,
        entityId: vf.entityId,
        domain: vf.domain,
        key: vf.key,
        value: vf.value,
        validity: vf.validity,
        meta: vf.meta,
        // createdAt/updatedAt sind hier egal für PURE-Änderungserkennung
      })),
      // haltung nicht nötig
    },
  });

  const f2 = out2.validatedFacts.find((f) => f.key === "rent_cold");
  assert.ok(f2, "expected rent_cold fact in run #2");
  assert.equal(f2.meta?.latest, true, "expected rent_cold meta.latest=true");

  // Für latest muss die factId gleich bleiben (entityId+key+"__latest__")
  assert.equal(
    f2.factId,
    f1.factId,
    "expected latest factId to be identical across value change"
  );

  // ✅ A4.3 Erwartung: NICHT new, NICHT ignored, sondern UPDATED
  assert.ok(
    Array.isArray((out2 as any).factsDiff?.updated),
    "expected factsDiff.updated to exist (did you add it in A4.3?)"
  );

  assert.ok(
    out2.factsDiff.updated.includes(f2.factId),
    `expected rent_cold factId to be in factsDiff.updated on run #2; got updated=${JSON.stringify(
      out2.factsDiff.updated
    )}`
  );

  assert.ok(
    !out2.factsDiff.new.includes(f2.factId),
    "expected rent_cold factId NOT to be in factsDiff.new on run #2"
  );

  assert.ok(
    !out2.factsDiff.ignored.includes(f2.factId),
    "expected rent_cold factId NOT to be in factsDiff.ignored on run #2"
  );

  console.log("✅ A4.3 UPDATE TEST PASSED", {
    factId: f2.factId.slice(0, 8),
    entityId: f2.entityId,
    key: f2.key,
    value_run1: f1.value,
    value_run2: f2.value,
    factsDiff2: out2.factsDiff,
  });
}

main().catch((e) => {
  console.error("❌ A4.3 UPDATE TEST FAILED", e);
  process.exit(1);
});