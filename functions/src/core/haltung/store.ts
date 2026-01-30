// functions/src/core/haltung/store.ts
// PHASE 3.1: Adaptive Core-Haltung – Firestore store (core-intern, versioniert)

import * as admin from "firebase-admin";
import { logger } from "../logging/logger";
import { CoreHaltungV1, defaultCoreHaltungV1 } from "./types";

function getDb() {
  return admin.firestore();
}

// Speicherort: brain/{userId}/core_haltung/v1
function haltungDocRef(userId: string) {
  return getDb()
    .collection("brain")
    .doc(userId)
    .collection("core_haltung")
    .doc("v1");
}

function clamp01(n: any, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

// 1) Load (oder anlegen, wenn fehlt)
export async function getOrCreateCoreHaltungV1(userId: string): Promise<CoreHaltungV1> {
  const ref = haltungDocRef(userId);
  const snap = await ref.get();

  if (snap.exists) {
    const d: any = snap.data() ?? {};
    // hart normalisieren – keine Magie, keine Strings, nur Zahlen 0..1
    const out: CoreHaltungV1 = {
      version: 1,
      directness: clamp01(d.directness, 0.5),
      interventionDepth: clamp01(d.interventionDepth, 0.5),
      patience: clamp01(d.patience, 0.5),
      escalationThreshold: clamp01(d.escalationThreshold, 0.7),
      reflectionLevel: clamp01(d.reflectionLevel, 0.5),
      updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
    };
    return out;
  }

  const created = defaultCoreHaltungV1();
  await ref.set(created, { merge: true });

  logger.info("core_haltung_created_v1", { userId });
  return created;
}