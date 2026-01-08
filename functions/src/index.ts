// functions/src/index.ts
import "dotenv/config";

// Side-effect: registriert Extractors (Registry) — NUR HIER
import "./core/facts/registryBootstrap";

import * as admin from "firebase-admin";
import * as functionsLogger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

import { getOpenAI, safeParseAssistantJson } from "./core/bridge";
import { haltungRef } from "./core/persistence/firestoreExecutorV1";

import { createApiHandler } from "./entry/apiHandler";
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

// API Handler (LLM / Haltung)
const apiHandler = createApiHandler({
  logger: functionsLogger,
  getOpenAI,
  safeParseAssistantJson,
  model: MODEL,
  readHaltung,
});

// Indexing Handler (rein, ohne LLM)
const indexingHandler = createIndexingHandler({
  logger: functionsLogger,
});

// Cloud Function Entry Points
export const api = onRequest(apiHandler);
export const indexing = onRequest(indexingHandler);