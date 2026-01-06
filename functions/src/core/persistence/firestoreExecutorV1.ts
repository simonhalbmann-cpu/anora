// functions/src/core/persistence/firestoreExecutorV1.ts
import admin from "firebase-admin";

const db = admin.firestore();

export function coreUserRoot(userId: string) {
  return db.collection("core").doc(userId);
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
  return admin
    .firestore()
    .collection("brain")
    .doc(userId)
    .collection("fact_history_v1")
    .doc(historyId);
}

export function evidenceRef(userId: string, evidenceId: string) {
  return admin
    .firestore()
    .collection("brain")
    .doc(userId)
    .collection("evidence_v1")
    .doc(evidenceId);
}

export function supersedesRef(userId: string, factId: string) {
  return admin
    .firestore()
    .collection("brain")
    .doc(userId)
    .collection("supersedes_v1")
    .doc(factId);
}
