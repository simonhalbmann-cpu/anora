// functions/src/core/bridge.ts
// Stabiler Import-Punkt für Domain-Code.
// Bridge exportiert nur zusammengeführte Abhängigkeiten.

import { logger } from "firebase-functions/v2";
import OpenAI from "openai";

import {
  INGEST_SYSTEM_PROMPT_DE,
  INGEST_SYSTEM_PROMPT_DE_VERSION,
} from "../prompt";

import { validateIngestFacts } from "../ingest/validateIngestFacts";

// Legacy: Übergang, bis Helpers sauber aus index.ts ausgelagert sind
import {
  safeParseAssistantJson,
  saveNewFacts,
  updateMietrechtContextFromFacts,
} from "./legacyExports";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY ist NICHT gesetzt. Bitte .env im functions-Ordner prüfen."
  );
}

export const openai = new OpenAI({ apiKey });

export {
  INGEST_SYSTEM_PROMPT_DE,
  INGEST_SYSTEM_PROMPT_DE_VERSION,
  logger,
  safeParseAssistantJson,
  saveNewFacts,
  updateMietrechtContextFromFacts,
  validateIngestFacts
};

