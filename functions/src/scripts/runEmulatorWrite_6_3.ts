// functions/src/scripts/runEmulatorWrite_6_3.ts
import { strict as assert } from "assert";
import admin from "firebase-admin";

import { runCoreWithPersistence } from "../core/bridgePure";

async function main() {
  // Connect admin SDK to Firestore emulator
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-anora" });
  }
  const db = admin.firestore();

  const userId = "u_emulator_test";
  const text = "hello persistence";

  // Run with dryRun=false => executor executes writePlan
  const out = await runCoreWithPersistence({
    userId,
    text,
    extractorIds: [], // no facts => facts plan none
    dryRun: false,
  });

  assert.equal(out.persistence.dryRun, false);
  // With extractorIds=[], writePlan = rawEvent append, facts none, haltung none
  assert.equal(out.writePlan.rawEvent, "append");
  assert.equal(out.writePlan.facts.mode, "none");
  assert.equal(out.writePlan.haltung.mode, "none");

  // Expect wrote=true (rawEvent append)
  assert.equal(out.persistence.wrote, true);
  assert.equal(out.persistence.reason, "executed");
  assert.equal(out.persistence.counts.rawEventsAppended, 1);

  // Read back rawEvent doc
  const rawEventId = out.rawEvent.rawEventId;
  const ref = db.collection("core").doc(userId).collection("rawEvents").doc(rawEventId);
  const snap = await ref.get();

  assert.equal(snap.exists, true, "rawEvent doc must exist in emulator");
  const doc = snap.data() as any;
  assert.equal(doc?.ingestHash, out.rawEvent.doc.ingestHash);

  console.log("✅ EMULATOR WRITE 6.3 PASSED", {
    rawEventId,
    counts: out.persistence.counts,
  });
}

main().catch((e) => {
  console.error("❌ EMULATOR WRITE 6.3 FAILED", e);
  process.exit(1);
});
