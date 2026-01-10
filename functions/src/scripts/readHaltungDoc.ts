import admin from "firebase-admin";

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error("usage: node lib/scripts/readHaltungDoc.js <userId>");

  if (!admin.apps.length) admin.initializeApp();

  const db = admin.firestore();
  const snap = await db.collection("core").doc(userId).collection("haltung").doc("v1").get();

  console.log(JSON.stringify({ exists: snap.exists, data: snap.data() ?? null }, null, 2));
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});