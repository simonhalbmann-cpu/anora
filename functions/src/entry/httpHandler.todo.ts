/**
 * httpHandler.todo.ts
 *
 * ALLES, was aus der legacy index.ts
 * schrittweise in den httpHandler
 * umgezogen werden MUSS.
 *
 * Diese Datei ist KEIN Code.
 * Sie ist ein verbindlicher Migrationsplan.
 *
 * Regel:
 * - Nichts hier importieren
 * - Nichts hiervon löschen
 * - Eintrag erst entfernen, wenn Code wirklich migriert ist
 */

// ==============================
// 1) Prompt / Copy
// ==============================
/*
import {
  FALLBACK_COPY_DE,
  PRESENCE_COPY_DE
} from "../copy/anoraCopy.de";

import {
  SYSTEM_PROMPT_DE,
  SYSTEM_PROMPT_DE_VERSION,
} from "../prompt";
*/

// ==============================
// 2) Policy / Ingest
// ==============================
/*
import {
  decideDocumentProcessingStrategy,
  type DocumentInput,
} from "../documentPolicy";

import { validateIngestFacts } from "../ingest/validateIngestFacts";
*/

// ==============================
// 3) Core – Haltung / Intervention
// ==============================
/*
import {
  computeCoreInterventionV1
} from "../core/interventions/controller";

import {
  enforceCoreResponseBoundaries
} from "../core/interventions/guard";

import {
  detectHaltungLearningEventFromMessage,
  deriveHaltungPatchFromEvent,
  applyHaltungLearningIfAny,
  getOrCreateCoreHaltungV1,
  patchCoreHaltungV1,
  computeHaltungTriggersFromMessage,
} from "../core/haltung/*";
*/

// ==============================
// 4) Satellites
// ==============================
/*
import { runLlmBrainSatellite } from "../core/satellites/llmBrain";

import type {
  BrainAction,
  BrainChatMessage,
  BrainContexts,
  BrainFactDoc,
  BrainFactInput,
  BrainInput,
  BrainOutput,
  BrainTask,
} from "../core/satellites/types";
*/

// ==============================
// 5) Domains
// ==============================
/*
import { mapRealEstateFactsToLegacyKnowledge }
  from "../domains/real_estate/adapter";
*/

// ==============================
// 6) Raw Events
// ==============================
/*
import { dayBucketUTC, sha256 }
  from "../core/rawEvents/hash";

import {
  appendRawEvent,
  getRawEventById,
  listRawEvents as listRawEventsFromStore,
} from "../core/rawEvents/store";

import type { RawEventDoc }
  from "../core/rawEvents/types";
*/

// ==============================
// 7) Facts / Entities
// ==============================
/*
import { getOrCreateEntityIdByFingerprint }
  from "../core/entities/store";

import {
  getExtractor,
} from "../core/facts/registry";

import {
  queryFacts,
  upsertManyFacts,
} from "../core/facts/store";
*/

// ==============================
// 8) Runner
// ==============================
/*
import {
  runAllExtractorsOnRawEventV1Core,
  runExtractorOnRawEventV1Core,
} from "../core/runner/*";
*/