import * as admin from "firebase-admin";

function getDb() {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}

async function main() {
  const db = getDb();

  const brainSnap = await db.collection("brain").get();
  console.log(`Users in brain/: ${brainSnap.size}`);

  let totalDocs = 0;
  let totalFixed = 0;

  for (const userDoc of brainSnap.docs) {
    const userId = userDoc.id;

    const rawSnap = await db.collection("brain").doc(userId).collection("rawEvents").get();
    if (rawSnap.empty) continue;

    for (const ev of rawSnap.docs) {
      totalDocs++;
      const data = ev.data() as Record<string, any>;
      const badKeys = Object.keys(data).filter((k) => k.startsWith("processing.v1."));

      if (badKeys.length === 0) continue;

      // Firestore update: FieldPath als EIN Segment -> löscht literal key mit Punkten
      const args: any[] = [];
      for (const k of badKeys) {
        args.push(new admin.firestore.FieldPath(k));
        args.push(admin.firestore.FieldValue.delete());
      }

      await (ev.ref.update as any)(...args);
      totalFixed++;

      console.log(`fixed user=${userId} rawEvent=${ev.id} removed=${badKeys.length}`);
    }
  }

  console.log(`Done. scanned=${totalDocs}, fixed=${totalFixed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});