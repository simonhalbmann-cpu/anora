// functions/src/scripts/runSupersedesTest_A4_5.ts
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

  const userId = `u_supersedes_a4_5_${Date.now()}`;

  const baseText = "Ich bin Vermieter in Berlin. Adresse: Musterstrasse 1.";
  const t1 = baseText + " Kaltmiete 1200 Euro.";
  const t2 = baseText + " Kaltmiete 900 Euro.";

  // ✅ Option A: Evidence gehört zum Core => core/{uid}/evidence_v1
  const evidenceColCore = (uid: string) =>
    db.collection("core").doc(uid).collection("evidence_v1");

  // ❌ Brain darf hier NICHT mehr benutzt werden (wir checken, dass es leer ist)
  const evidenceColBrain = (uid: string) =>
    db.collection("brain").doc(uid).collection("evidence_v1");

  // --- RUN 1 ---
  const out1 = await runCoreWithPersistence({
    userId,
    text: t1,
    dryRun: false,
  });

  if (out1.persistence.reason === "failed") {
    console.error("⛔ PERSISTENCE FAILED (RUN 1):", out1.persistence.error);
    process.exit(1);
  }

  assert.equal(out1.persistence.reason, "executed");

  // rent_cold factId finden
  const rent1 = out1.validatedFacts.find((f: any) => f.key === "rent_cold");
  assert.ok(rent1?.factId, "missing rent_cold factId in out1.validatedFacts");

  // Evidence docs nach factId holen (Run1 sollte 1 Evidence für rent_cold erzeugen)
  const evSnap1_core = await evidenceColCore(userId)
    .where("factId", "==", String(rent1.factId))
    .get();

  const evSnap1_brain = await evidenceColBrain(userId)
    .where("factId", "==", String(rent1.factId))
    .get();

  console.log("DEBUG evidence location (run1)", {
    core: evSnap1_core.size,
    brain: evSnap1_brain.size,
  });

  // ✅ Option A: brain MUSS 0 sein
  assert.equal(
    evSnap1_brain.size,
    0,
    "expected NO evidence in brain/evidence_v1 (Option A)"
  );

  // ✅ Option A: core MUSS 1 sein
  assert.equal(
    evSnap1_core.size,
    1,
    `expected 1 evidence doc in core/evidence_v1 after run1, got ${evSnap1_core.size}`
  );

  const ev1 = evSnap1_core.docs[0].data() as any;

  assert.ok(ev1.evidenceId, "missing evidenceId in ev1");
  assert.equal(
    ev1.sourceRef,
    out1.rawEvent.rawEventId,
    "expected ev1.sourceRef == run1 rawEventId"
  );
  assert.ok(
    ev1.supersededBy === null || typeof ev1.supersededBy === "undefined",
    "expected ev1.supersededBy null/undefined"
  );
  assert.ok(
    ev1.supersededAt === null || typeof ev1.supersededAt === "undefined",
    "expected ev1.supersededAt null/undefined"
  );

  // --- RUN 2 (Update) ---
  const out2 = await runCoreWithPersistence({
    userId,
    text: t2,
    dryRun: false,
  });

  if (out2.persistence.reason === "failed") {
    console.error("⛔ PERSISTENCE FAILED (RUN 2):", out2.persistence.error);
    process.exit(1);
  }

  assert.equal(out2.persistence.reason, "executed");

  const rent2 = out2.validatedFacts.find((f: any) => f.key === "rent_cold");
  assert.ok(rent2?.factId, "missing rent_cold factId in out2.validatedFacts");

  // Bei latest muss factId gleich bleiben
  assert.equal(
    String(rent2.factId),
    String(rent1.factId),
    "expected same factId for latest rent_cold"
  );

  // Jetzt müssen 2 evidence docs existieren (run1 + run2)
  const evSnap2_core = await evidenceColCore(userId)
    .where("factId", "==", String(rent2.factId))
    .get();

  const evSnap2_brain = await evidenceColBrain(userId)
    .where("factId", "==", String(rent2.factId))
    .get();

  console.log("DEBUG evidence location (run2)", {
    core: evSnap2_core.size,
    brain: evSnap2_brain.size,
  });

  assert.equal(
    evSnap2_brain.size,
    0,
    "expected NO evidence in brain/evidence_v1 (Option A)"
  );
  assert.equal(
    evSnap2_core.size,
    2,
    `expected 2 evidence docs in core/evidence_v1 after run2, got ${evSnap2_core.size}`
  );

  const evDocs = evSnap2_core.docs.map((doc: any) => doc.data() as any);

  // Wir identifizieren alt vs neu via sourceRef/rawEventId
  const evOld = evDocs.find((x: any) => x.sourceRef === out1.rawEvent.rawEventId);
  const evNew = evDocs.find((x: any) => x.sourceRef === out2.rawEvent.rawEventId);

  assert.ok(evOld, "expected old evidence (sourceRef=run1 rawEventId)");
  assert.ok(evNew, "expected new evidence (sourceRef=run2 rawEventId)");

  // ✅ Kernassertion: old supersededBy -> new.evidenceId
  assert.equal(
    String(evOld.supersededBy),
    String(evNew.evidenceId),
    "expected evOld.supersededBy to point to evNew.evidenceId"
  );
  assert.ok(typeof evOld.supersededAt === "number", "expected evOld.supersededAt number");

  // New darf NICHT superseded sein
  assert.ok(
    evNew.supersededBy === null || typeof evNew.supersededBy === "undefined",
    "expected evNew.supersededBy null/undefined"
  );
  assert.ok(
    evNew.supersededAt === null || typeof evNew.supersededAt === "undefined",
    "expected evNew.supersededAt null/undefined"
  );

  console.log("✅ A4.5 SUPERSEDES TEST PASSED", {
    factId: String(rent2.factId).slice(0, 8),
    evOld: { evidenceId: evOld.evidenceId, supersededBy: evOld.supersededBy },
    evNew: { evidenceId: evNew.evidenceId },
  });
}

main().catch((e) => {
  console.error("⛔ A4.5 SUPERSEDES TEST FAILED", e);
  process.exit(1);
});