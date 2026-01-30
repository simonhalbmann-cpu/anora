// functions/src/core/meta/contextStore.ts

import type { Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

// ------------------------------------------------------------
// Generische Meta-Helper fÃ¼r brain/{userId}/meta/{key}
// ------------------------------------------------------------
export type MetaContextDoc = {
  updatedAt: number;
  [key: string]: any;
};

export async function setMetaContext(
  db: Firestore,
  userId: string,
  key: string,
  payload: Record<string, any>
): Promise<void> {
  const ref = db
    .collection("brain")
    .doc(userId)
    .collection("meta")
    .doc(key);

  const doc = {
    ...payload,
    updatedAt: Date.now(),
  };

  await ref.set(doc, { merge: true });

  logger.info("meta_write", {
    userId,
    metaKey: key,
    payloadKeys: Object.keys(payload),
    hasUpdatedAt: !!doc.updatedAt,
  });
}

export async function getMetaContext(
  db: Firestore,
  userId: string,
  key: string
): Promise<MetaContextDoc | null> {
  const ref = db
    .collection("brain")
    .doc(userId)
    .collection("meta")
    .doc(key);

  const snap = await ref.get();
  if (!snap.exists) return null;

  return snap.data() as MetaContextDoc;
}