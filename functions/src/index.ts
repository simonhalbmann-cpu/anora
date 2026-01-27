// functions/src/index.ts
import "dotenv/config";

// Side-effect: registriert Extractors (Registry) — NUR HIER
import "./core/facts/registryBootstrap";

import * as admin from "firebase-admin";
import * as functionsLogger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

import { getOpenAI, safeParseAssistantJson } from "./core/bridge";
import { haltungRef } from "./core/persistence/firestoreExecutorV1";

import type { FactDoc } from "./core/facts/types";
import { createApiHandler } from "./entry/createApiHandler";
import { createDigestHandler } from "./entry/digestHandler";
import { createIndexingHandler } from "./entry/indexingHandler";

// Firebase Admin init (genau einmal)
if (!admin.apps.length) {
  admin.initializeApp();
}

// OpenAI Model (zentral)
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// DI: Haltung laden
async function readHaltung(userId: string) {
  const snap = await haltungRef(userId).get();
  return snap.exists ? (snap.data() as any) : undefined;
}

async function readFacts(userId: string): Promise<FactDoc[]> {
  const col = admin.firestore().collection("brain").doc(userId).collection("facts");

  // Minimal: hol eine überschaubare Menge, filter aktiv-only im Code:
  const snap = await col.limit(200).get();

  const docs = snap.docs.map((d) => d.data() as any);

  // aktiv-only: isSuperseded !== true (false oder undefined gilt als aktiv)
  return docs.filter((x) => x && x.isSuperseded !== true) as FactDoc[];
}

// API Handler (LLM / Haltung)
const apiHandler = createApiHandler({
  logger: functionsLogger,
  getOpenAI,
  safeParseAssistantJson,
  model: MODEL,
  readHaltung,
  readFacts,
});

// Indexing Handler (rein, ohne LLM)
const indexingHandler = createIndexingHandler({
  logger: functionsLogger,
});

const digestHandler = createDigestHandler({
  logger: functionsLogger,
});

// Cloud Function Entry Points
export const api = onRequest(apiHandler);
export const indexing = onRequest(indexingHandler);
export const digest = onRequest(digestHandler);