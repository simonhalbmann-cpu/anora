

import { strict as assert } from "assert";
import { createHash } from "crypto";
import admin from "firebase-admin";
import "../core/facts/registryBootstrap";
import { runCoreWithPersistence } from "../core/runCoreWithPersistence";



function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function evidenceIdFor(factId: string, sourceRef: string) {
  return sha256Hex(`evidence::${factId}::${sourceRef}`);
}

function historyIdFor(factId: string, sourceRef: string, kind: "created" | "updated" | "superseded") {
  return sha256Hex(`history::${factId}::${sourceRef}::${kind}`);
}


async function main() {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-anora" });
  }
  const db = admin.firestore();

  // WICHTIG: Executor schreibt Facts nach: core/{userId}/facts/{factId}
const factRef = (userId: string, factId: string) =>
  db.collection("core").doc(userId).collection("facts").doc(factId);

// ✅ Option A: History nach core/{userId}/fact_history_v1/{historyId}
const factHistoryCol = (userId: string) =>
  db.collection("core").doc(userId).collection("fact_history_v1");

// ✅ Option A: Evidence nach core/{userId}/evidence_v1/{evidenceId}
const evidenceCol = (userId: string) =>
  db.collection("core").doc(userId).collection("evidence_v1");

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

// Evidence prüfen: ev1 muss superseded sein, ev2 muss aktuell sein
const factId = String(rentFact2.factId);
const sourceRef1 = out1.rawEvent.rawEventId;
const sourceRef2 = out2.rawEvent.rawEventId;

const ev1Id = evidenceIdFor(factId, sourceRef1);
const ev2Id = evidenceIdFor(factId, sourceRef2);

const ev1Snap = await evidenceCol(userId).doc(ev1Id).get();
const ev2Snap = await evidenceCol(userId).doc(ev2Id).get();

assert.equal(ev1Snap.exists, true, "expected ev1 to exist");
assert.equal(ev2Snap.exists, true, "expected ev2 to exist");

const ev1: any = ev1Snap.data();
const ev2: any = ev2Snap.data();

// ev1 muss supersededBy=ev2 haben + supersededAt gesetzt
assert.equal(ev1.supersededBy, ev2Id, "expected ev1.supersededBy to point to ev2");
assert.equal(typeof ev1.supersededAt, "number", "expected ev1.supersededAt to be a number");

// ev2 muss clean sein
assert.equal(ev2.supersededBy, null, "expected ev2.supersededBy=null");
assert.equal(ev2.supersededAt, null, "expected ev2.supersededAt=null");

// history -> created + superseded + updated (mindestens 3)
const histSnap = await factHistoryCol(userId)
  .where("factId", "==", String(rentFact2.factId))
  .get();

assert.ok(histSnap.size >= 3, `expected >=3 history entries, got ${histSnap.size}`);

const kinds = histSnap.docs.map((d) => String(d.data().kind));
assert.ok(kinds.includes("created"), "expected history to include kind=created");
assert.ok(kinds.includes("updated"), "expected history to include kind=updated");
assert.ok(kinds.includes("superseded"), "expected history to include kind=superseded");

// Optional aber brutal beweisend: checke die deterministischen History-IDs
const hCreatedId = historyIdFor(factId, sourceRef1, "created");
const hSupId     = historyIdFor(factId, sourceRef1, "superseded");
const hUpdatedId = historyIdFor(factId, sourceRef2, "updated");

const hCreated = await factHistoryCol(userId).doc(hCreatedId).get();
const hSup     = await factHistoryCol(userId).doc(hSupId).get();
const hUpdated = await factHistoryCol(userId).doc(hUpdatedId).get();

assert.equal(hCreated.exists, true, "expected created history doc to exist");
assert.equal(hSup.exists, true, "expected superseded history doc to exist");
assert.equal(hUpdated.exists, true, "expected updated history doc to exist");

  

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