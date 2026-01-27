// functions/src/scripts/runResolverSmokeTest.ts
import "dotenv/config";
import * as admin from "firebase-admin";
import { upsertConflictTicket } from "../core/facts/conflicts";
import { resolveCandidates } from "../core/facts/resolveCandidates";

// 🔧 Force Emulator + Project (damit wir sicher die gleichen Daten wie devListFacts sehen)
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "anoraapp-ai";
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

console.log("GCLOUD_PROJECT =", process.env.GCLOUD_PROJECT);
console.log("FIRESTORE_EMULATOR_HOST =", process.env.FIRESTORE_EMULATOR_HOST);

// 1) Admin init (einmal)
if (!admin.apps.length) admin.initializeApp();

async function main() {
  const uid = process.env.TEST_UID;
  if (!uid) throw new Error("Setze TEST_UID in functions/.env");

  // Wir nehmen absichtlich die echte Stelle aus deinem Output:
  const entityId =
    "fp:b836baa849d43f23ad7e5cbe8ea595f0c02fbb8181700d1820b30f6141272125";
  const key = "doc:summary";

  const col = admin.firestore().collection("brain").doc(uid).collection("facts");

  // Kandidaten: gleicher entityId + key, aktiv (isSuperseded != true)
  const snap = await col.where("entityId", "==", entityId).where("key", "==", key).get();
  const all = snap.docs.map((d) => d.data() as any).filter((x) => x?.isSuperseded !== true);

  // PHASE 3.4 – absichtlich zweiten konkurrierenden Fact erzeugen
if (all.length === 1) {
  const clone = {
    ...all[0],
    factId: "manual_conflict_test_fact",
    value: { ...all[0].value, __conflictTest: true },
    updatedAt: Date.now(),
  };
  all.push(clone);
}

  console.log("CANDIDATES:", all.length);

  const result = resolveCandidates(entityId, key, all);
  console.log("RESULT:", JSON.stringify(result, null, 2));

  // --- PHASE 3.1: Conflict Ticket schreiben (wenn nötig) ---
  await upsertConflictTicket({
    uid,
    entityId,
    key,
    candidates: all,
    resolveResult: result as any,
    debugScores: (result as any).debugScores ?? [],
  });

  const conflictDocId = `conflict_v1__${entityId}__${key}`;
  const conflictRef = admin.firestore().doc(`brain/${uid}/meta/${conflictDocId}`);
  const conflictSnap = await conflictRef.get();

  console.log("CONFLICT_DOC_EXISTS:", conflictSnap.exists);
  if (conflictSnap.exists) {
    console.log("CONFLICT_DOC_ID:", conflictDocId);
  }


// --- Mini-Assertions (blutiger Anfänger: einfach & hart) ---
  if (!result) throw new Error("FAIL: result ist leer");

  if (result.status !== "resolved" && result.status !== "resolved_with_conflict") {
    throw new Error(`FAIL: status ist nicht resolved/resolved_with_conflict, sondern: ${result.status}`);
  }

  if (!("winner" in result) || !result.winner?.factId) {
    throw new Error("FAIL: winner fehlt oder hat keine factId");
  }

  // Wir erwarten bei deinem Fall: conflict=true (weil 2 unterschiedliche values)
  if (!result.conflict) {
    throw new Error("FAIL: conflict sollte TRUE sein, ist aber FALSE");
  }

  console.log("✅ PASS: Resolver liefert winner + conflict=true (status ok)");

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});