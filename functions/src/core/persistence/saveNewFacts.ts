// functions/src/core/persistence/saveNewFacts.ts

import admin from "firebase-admin";

// Wichtig: db exakt so erstellen wie im God-File
const db = admin.firestore();

export type BrainFactInput = {
  type?: string;
  tags?: string[];
  data?: any;
  raw?: string;
};

export async function saveNewFacts(userId: string, facts: BrainFactInput[]) {
  if (!facts || facts.length === 0) return;

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