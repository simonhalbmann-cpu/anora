// functions/src/scripts/runEmulatorWrite_facts_6_3.ts
import { strict as assert } from "assert";
import admin from "firebase-admin";

import { runCoreWithPersistence } from "../core/runCoreWithPersistence";

// IMPORTANT: this import bootstraps extractors (impure due to firebase-functions/logger)
import "../core/facts/registryBootstrap";

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-anora" });
  }
  const db = admin.firestore();

  const userId = "u_emulator_facts";
  const text =
    "Ich bin Vermieter in Berlin. Die Wohnung hat 80 qm, 3 Zimmer, Kaltmiete 1200 Euro. Adresse: Musterstraße 1.";

  // First run: should create NEW facts (depends on extractor)
  const out = await runCoreWithPersistence({
    userId,
    text,
    dryRun: false,
    // extractorIds omitted => listExtractors() from registry (populated by bootstrap)
  });

  assert.equal(out.persistence.dryRun, false);
  assert.equal(out.writePlan.rawEvent, "append");

  const newFacts = out.factsDiff.new.length;

  // If extractor yields zero facts, we fail loudly (proof needs at least 1)
  assert.ok(newFacts > 0, `expected extractor to produce >0 new facts, got=${newFacts}`);

  assert.equal(out.writePlan.facts.mode, "upsert");
  assert.equal(out.writePlan.facts.count, newFacts);

  assert.equal(out.persistence.wrote, true);
  assert.equal(out.persistence.reason, "executed");
  assert.equal(out.persistence.counts.factsUpserted, newFacts);

  // Read back one fact doc
  const anyFactId = out.factsDiff.new[0];
  const factRef = db.collection("core").doc(userId).collection("facts").doc(anyFactId);
  const snap = await factRef.get();

  assert.equal(snap.exists, true, "fact doc must exist in emulator");
  const factDoc = snap.data() as any;
  assert.equal(factDoc?.factId, anyFactId);

  console.log("✅ EMULATOR FACTS WRITE 6.3 PASSED", {
    newFacts,
    sampleFactId: anyFactId,
    counts: out.persistence.counts,
  });
}

main().catch((e) => {
  console.error("❌ EMULATOR FACTS WRITE 6.3 FAILED", e);
  process.exit(1);
});
