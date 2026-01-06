

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

  // --- Test-only Firestore refs (NICHT aus Executor importieren!) ---
// WICHTIG: Executor schreibt Facts nach: core/{userId}/facts/{factId}
const factRef = (userId: string, factId: string) =>
  db.collection("core").doc(userId).collection("facts").doc(factId);

// WICHTIG: Executor schreibt History nach: brain/{userId}/fact_history_v1/{historyId}
const factHistoryCol = (userId: string) =>
  db.collection("brain").doc(userId).collection("fact_history_v1");

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

  if (out1.persistence.reason === "failed") {
    console.error("❌ PERSISTENCE FAILED (RUN 1):", out1.persistence.error);
    process.exit(1);
  }

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

if (out2.persistence.reason === "failed") {
    console.error("❌ PERSISTENCE FAILED (RUN 2):", out2.persistence.error);
    process.exit(1);
  }

  assert.equal(out2.persistence.dryRun, false);
  assert.equal(out2.persistence.reason, "executed");
  assert.equal(out2.persistence.counts.rawEventsAppended, 1);
  assert.ok(out2.persistence.counts.factsUpserted >= 1);

  // facts_v1 -> rent_cold muss 900 sein
  const rentFact2 = out2.validatedFacts.find((f: any) => f.key === "rent_cold");
assert.ok(rentFact2?.factId, "missing rent_cold factId in out2.validatedFacts");

const rentSnap = await factRef(userId, String(rentFact2.factId)).get();
assert.equal(rentSnap.exists, true, "expected rent_cold fact doc to exist");
const rentDoc: any = rentSnap.data();

assert.equal(rentDoc.key, "rent_cold", "expected key=rent_cold");
assert.equal(rentDoc.value, 900, "expected latest rent_cold=900");

  // history -> mindestens 2 Einträge (created + updated)
  const histSnap = await factHistoryCol(userId)
  .where("factId", "==", String(rentFact2.factId))
  .get();

assert.ok(histSnap.size >= 2, `expected >=2 history entries, got ${histSnap.size}`);

const kinds = histSnap.docs.map((d) => String(d.data().kind));
assert.ok(kinds.includes("created"), "expected history to include kind=created");
assert.ok(kinds.includes("updated"), "expected history to include kind=updated");

  

  console.log("✅ A4.4 UPDATE+HISTORY TEST PASSED", {
    factsUpserted_run1: out1.persistence.counts.factsUpserted,
    factsUpserted_run2: out2.persistence.counts.factsUpserted,
    historyCount: histSnap.size,
    latestRentCold: rentDoc.value,
  });
}

main().catch((e) => {
  console.error("❌ A4.4 UPDATE+HISTORY TEST FAILED", e);
  process.exit(1);
});