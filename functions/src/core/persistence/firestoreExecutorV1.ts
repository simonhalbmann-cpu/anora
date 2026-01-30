// functions/src/core/persistence/firestoreExecutorV1.ts
import admin from "firebase-admin";

// WICHTIG: kein admin.firestore() auf Top-Level!
// Sonst crasht/hÃ¤ngt es beim Import, bevor index.ts initializeApp() ausfÃ¼hrt.

function getDb() {
  // defensiv: falls jemand diese Datei jemals ohne index.ts benutzt
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

export function coreUserRoot(userId: string) {
  // Single Source of Truth: brain/{userId}/...
  return getDb().collection("brain").doc(userId);
}

export function rawEventRef(userId: string, rawEventId: string) {
  return coreUserRoot(userId).collection("rawEvents").doc(rawEventId);
}

export function factRef(userId: string, factId: string) {
  return coreUserRoot(userId).collection("facts").doc(factId);
}

export function haltungRef(userId: string) {
  return coreUserRoot(userId).collection("haltung").doc("v1");
}

export function factHistoryRef(userId: string, historyId: string) {
  return coreUserRoot(userId).collection("fact_history_v1").doc(historyId);
}

export function evidenceRef(userId: string, evidenceId: string) {
  return coreUserRoot(userId).collection("evidence_v1").doc(evidenceId);
}


