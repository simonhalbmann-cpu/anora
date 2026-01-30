// functions/src/core/rawEvents/store.ts

import admin from "firebase-admin";
import type {
  RawEventDoc,
  RawEventProcessing,
} from "./types";
function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

;

function rawEventsCol(userId: string) {
  const db = getDb();
  return db.collection("brain").doc(userId).collection("rawEvents");
}

export async function markRawEventRunStart(opts: {
  userId: string;
  rawEventId: string;
  runner: string; // z.B. "runAllExtractorsOnRawEventV1"
  extractorIds?: string[];

  // audit (optional)
  model?: string;
  promptVersion?: string;
}) {
  const { userId, rawEventId, runner, extractorIds, model, promptVersion } = opts;

  await rawEventsCol(userId).doc(rawEventId).set(
    {
      processing: {
        v1: {
          status: "running",
          runner,
          extractorIds: Array.isArray(extractorIds) ? extractorIds : [],
          startedAt: Date.now(),

          ...(model || promptVersion
            ? { prompt: { model: model ?? null, version: promptVersion ?? null } }
            : {}),
        },
      },
    } as any,
    { merge: true }
  );
}

export async function markRawEventRunDone(opts: {
  userId: string;
  rawEventId: string;
  runner: string;
  stats: Record<string, any>;

  // audit (optional)
  model?: string;
  promptVersion?: string;
}) {
  const { userId, rawEventId, runner, stats, model, promptVersion } = opts;

  await rawEventsCol(userId).doc(rawEventId).set(
    {
      processing: {
        v1: {
          status: "done",
          runner,
          finishedAt: Date.now(),
          stats,

          ...(model || promptVersion
            ? { prompt: { model: model ?? null, version: promptVersion ?? null } }
            : {}),
        },
      },
    } as any,
    { merge: true }
  );
}

export async function markRawEventRunError(opts: {
  userId: string;
  rawEventId: string;
  runner: string;
  error: any;
}) {
  const { userId, rawEventId, runner, error } = opts;

  const msg = String(error?.message ?? error ?? "unknown_error");
  const stack = String(error?.stack ?? "");
  const shortStack = stack.length > 2000 ? stack.slice(0, 2000) : stack;

  await rawEventsCol(userId).doc(rawEventId).set(
    {
      processing: {
        v1: {
          status: "error",
          runner,
          finishedAt: Date.now(),
          error: {
            message: msg,
            stack: shortStack,
          },
        },
      },
    } as any,
    { merge: true }
  );
}

export async function getRawEventById(
  userId: string,
  id: string
): Promise<RawEventDoc | null> {
  const snap = await rawEventsCol(userId).doc(id).get();
  return snap.exists ? (snap.data() as RawEventDoc) : null;
}

export async function patchRawEventProcessing(
  userId: string,
  rawEventId: string,
  patch: RawEventProcessing
): Promise<void> {
  const ref = rawEventsCol(userId).doc(rawEventId);

  // Wichtig: KEINE Field-Paths wie "processing.v1.status" bauen,
  // sonst entstehen flache Felder "processing.v1.*" neben der echten Map.
  if (!patch || typeof patch !== "object") return;

  await ref.set({ processing: patch } as any, { merge: true });
}




