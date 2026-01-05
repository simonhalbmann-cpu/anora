import { strict as assert } from "assert";
import admin from "firebase-admin";
import "../core/facts/registryBootstrap";
import { runCoreWithPersistence } from "../core/runCoreWithPersistence";

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-anora" });
  }
  const db = admin.firestore();

  const userId = `u_update_a4_4_${Date.now()}`;

  const baseText = "Ich bin Vermieter in Berlin. Adresse: Musterstraße 1.";
  const t1 = baseText + " Kaltmiete 1200 Euro.";
  const t2 = baseText + " Kaltmiete 900 Euro.";

  // RUN 1
  const out1 = await runCoreWithPersistence({
    userId,
    text: t1,
    dryRun: false,
  });

  assert.equal(out1.persistence.dryRun, false);
  assert.equal(out1.persistence.reason, "executed");
  assert.equal(out1.persistence.counts.rawEventsAppended, 1);
  assert.ok(out1.persistence.counts.factsUpserted >= 1);

  // RUN 2 (update)
  const out2 = await runCoreWithPersistence({
    userId,
    text: t2,
    dryRun: false,
  });

  assert.equal(out2.persistence.dryRun, false);
  assert.equal(out2.persistence.reason, "executed");
  assert.equal(out2.persistence.counts.rawEventsAppended, 1);
  assert.ok(out2.persistence.counts.factsUpserted >= 1);

  // facts_v1 -> rent_cold muss 900 sein
  const factsSnap = await db
    .collection("brain")
    .doc(userId)
    .collection("facts_v1")
    .where("key", "==", "rent_cold")
    .get();

  assert.equal(factsSnap.size, 1, "expected exactly 1 latest rent_cold fact");
  const fact = factsSnap.docs[0].data();
  assert.equal(fact.value, 900, "expected latest rent_cold=900");

  // history -> mindestens 2 Einträge (created + updated)
  const histSnap = await db
    .collection("brain")
    .doc(userId)
    .collection("fact_history_v1")
    .where("key", "==", "rent_cold")
    .get();

  assert.ok(histSnap.size >= 2, `expected >=2 history entries, got ${histSnap.size}`);

  const kinds = histSnap.docs.map((d) => String(d.data().kind));
  assert.ok(kinds.includes("created"), "expected history to include kind=created");
  assert.ok(kinds.includes("updated"), "expected history to include kind=updated");

  console.log("✅ A4.4 UPDATE+HISTORY TEST PASSED", {
    factsUpserted_run1: out1.persistence.counts.factsUpserted,
    factsUpserted_run2: out2.persistence.counts.factsUpserted,
    historyCount: histSnap.size,
    latestRentCold: fact.value,
  });
}

main().catch((e) => {
  console.error("❌ A4.4 UPDATE+HISTORY TEST FAILED", e);
  process.exit(1);
});