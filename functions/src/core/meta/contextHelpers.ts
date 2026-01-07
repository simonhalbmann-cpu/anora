// Generische Meta-Helper fÃ¼r brain/{userId}/meta/{key}
// ------------------------------------------------------------

import * as logger from "firebase-functions/logger";
import { getDb } from "../firebase/getDb";

type MetaContextDoc = {
  updatedAt: number;
  [key: string]: any;
};

async function setMetaContext(
  userId: string,
  key: string,
  payload: Record<string, any>
): Promise<void> {
  const db = getDb();
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

  // ðŸ” zentrales Logging fÃ¼r ALLE Meta-Writes
  logger.info("meta_write", {
    userId,
    metaKey: key,
    payloadKeys: Object.keys(payload),
    hasUpdatedAt: !!doc.updatedAt,
  });
}

async function getMetaContext(
  userId: string,
  key: string
): Promise<MetaContextDoc | null> {
  const db = getDb();
  const ref = db
    .collection("brain")
    .doc(userId)
    .collection("meta")
    .doc(key);

  const snap = await ref.get();
  if (!snap.exists) return null;

  return snap.data() as MetaContextDoc;
}

async function clearMetaContext(userId: string, key: string): Promise<void> {
  const db = getDb();
  const ref = db
    .collection("brain")
    .doc(userId)
    .collection("meta")
    .doc(key);

  await ref.delete();

  // ðŸ” zentrales Logging fÃ¼r Meta-LÃ¶schungen
  logger.info("meta_clear", {
    userId,
    metaKey: key,
  });
}


// ------------------------------------------------------------
// Spezielle Reset-Helper fÃ¼r einzelne Kontexte
// ------------------------------------------------------------

// Beispiel: Kontext "letzter Mieter" zurÃ¼cksetzen
async function resetTenantContext(userId: string): Promise<void> {
  await clearMetaContext(userId, "tenantContext");
}

// propertyContext: aktuelles Objekt / letzte Immobilie
async function resetPropertyContext(userId: string): Promise<void> {
  await clearMetaContext(userId, "propertyContext");
}

async function resetCityContext(userId: string): Promise<void> {
  await clearMetaContext(userId, "cityContext");
}

async function setTenantContext(userId: string, value: Record<string, any>) {
  await setMetaContext(userId, "tenantContext", value);
}

async function setPropertyContext(
  userId: string,
  value: Record<string, any>
) {
  await setMetaContext(userId, "propertyContext", value);
}

async function setCityContext(userId: string, value: Record<string, any>) {
  await setMetaContext(userId, "cityContext", value);
}



