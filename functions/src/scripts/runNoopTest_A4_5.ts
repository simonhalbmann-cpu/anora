import { strict as assert } from "assert";
import admin from "firebase-admin";
import "../core/facts/registryBootstrap";
import { runCoreWithPersistence } from "../core/runCoreWithPersistence";

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-anora" });
  }

  const userId = `u_noop_a4_5_${Date.now()}`;

  const text =
    "Ich bin Vermieter in Berlin. Adresse: Musterstraße 1. Kaltmiete 1200 Euro.";

  // RUN 1: sollte schreiben
  const out1 = await runCoreWithPersistence({
    userId,
    text,
    dryRun: false,
  });

  if (out1.persistence.reason === "failed") {
    console.error("⛔ PERSISTENCE FAILED (RUN 1):", out1.persistence.error);
    process.exit(1);
  }

  assert.equal(out1.persistence.dryRun, false);
  assert.equal(out1.persistence.reason, "executed");
  assert.ok(out1.persistence.counts.rawEventsAppended >= 1);
  assert.ok(out1.persistence.counts.factsUpserted >= 1);

  // RUN 2: IDENTISCHER INPUT -> muss NOOP sein
  const out2 = await runCoreWithPersistence({
    userId,
    text,
    dryRun: false,
  });

  if (out2.persistence.reason === "failed") {
    console.error("⛔ PERSISTENCE FAILED (RUN 2):", out2.persistence.error);
    process.exit(1);
  }

  assert.equal(out2.persistence.dryRun, false);
  assert.equal(out2.persistence.reason, "noop");
  // wrote ist in deinem Status bei noop implizit false, aber wir prüfen robust:
  assert.equal((out2.persistence as any).wrote ?? false, false);

  assert.deepEqual(out2.persistence.counts, {
    rawEventsAppended: 0,
    factsUpserted: 0,
    haltungPatched: 0,
    historyAppended: 0,
    evidenceAppended: 0,
  });

  console.log("✅ A4.5 NOOP TEST PASSED", {
    run1_counts: out1.persistence.counts,
    run2_counts: out2.persistence.counts,
  });
}

main().catch((e) => {
  console.error("⛔ A4.5 NOOP TEST FAILED", e);
  process.exit(1);
});