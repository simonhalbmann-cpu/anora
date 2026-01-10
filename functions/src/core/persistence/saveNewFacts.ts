// functions/src/core/persistence/saveNewFacts.ts

import admin from "firebase-admin";

// WICHTIG: niemals admin.firestore() auf Top-Level,
// weil der Functions-Emulator Module importiert, bevor index.ts initializeApp() ausführt.
function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

export type BrainFactInput = {
  type?: string;
  tags?: string[];
  data?: any;
  raw?: string;
};

export async function saveNewFacts(userId: string, facts: BrainFactInput[]) {
  if (!facts || facts.length === 0) return;

  const db = getDb();
  const col = db.collection("brain").doc(userId).collection("facts");
  const batch = db.batch();
  const now = Date.now();

  for (const fact of facts) {
    const ref = col.doc();
    batch.set(ref, {
      type: fact.type || "generic",
      tags: Array.isArray(fact.tags) ? fact.tags : [],
      data: fact.data ?? {},
      raw: fact.raw ?? "",
      createdAt: now,
      userId,
    });
  }

  await batch.commit();
}