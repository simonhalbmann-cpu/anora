// functions/src/index.ts

import dotenvx from "dotenv";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import OpenAI from "openai";

// IMPORTANT: side-effect import – registers extractors at startup
import "./core/facts/registryBootstrap";

import {
  FALLBACK_COPY_DE,
  PRESENCE_COPY_DE
} from "./copy/anoraCopy.de";

import {
  SYSTEM_PROMPT_DE,
  SYSTEM_PROMPT_DE_VERSION,
} from "./prompt";

import {
  decideDocumentProcessingStrategy,
  type DocumentInput,
} from "./documentPolicy";

import { validateIngestFacts } from "./ingest/validateIngestFacts";

import { computeCoreInterventionV1 } from "./core/interventions/controller";
import { enforceCoreResponseBoundaries } from "./core/interventions/guard";

import { detectHaltungLearningEventFromMessage } from "./core/haltung/detect";
import { deriveHaltungPatchFromEvent } from "./core/haltung/learn";
import { applyHaltungLearningIfAny } from "./core/haltung/learning";
import { getOrCreateCoreHaltungV1, patchCoreHaltungV1 } from "./core/haltung/store";
import { computeHaltungTriggersFromMessage } from "./core/haltung/triggers";

import { runLlmBrainSatellite } from "./core/satellites/llmBrain";
import type {
  BrainAction,
  BrainChatMessage,
  BrainContexts,
  BrainFactDoc,
  BrainFactInput,
  BrainInput,
  BrainOutput,
  BrainTask,
} from "./core/satellites/types";

import { mapRealEstateFactsToLegacyKnowledge } from "./domains/real_estate/adapter";

import { dayBucketUTC, sha256 } from "./core/rawEvents/hash";
import {
  appendRawEvent,
  getRawEventById,
  listRawEvents as listRawEventsFromStore,
} from "./core/rawEvents/store";
import type { RawEventDoc } from "./core/rawEvents/types";

import { getExtractor } from "./core/facts/registry";
import { queryFacts, upsertManyFacts } from "./core/facts/store";

import { getOrCreateEntityIdByFingerprint } from "./core/entities/store";

import { runAllExtractorsOnRawEventV1Core } from "./core/runner/runAllExtractorsOnRawEventV1";
import { runExtractorOnRawEventV1Core } from "./core/runner/runExtractorOnRawEventV1";

// ---- Umgebungsvariablen laden (.env im functions-Ordner) ----
dotenvx.config();

// ------------------------------------------------------------
// Globale Limits für Stabilität (Antworten, Kontext, Wissen)
// ------------------------------------------------------------
const MAX_REPLY_LENGTH = 2000;         // maximale Länge der KI-Antwort Richtung Client
const MAX_FACTS_PER_PROMPT = 50;       // wie viele Facts gehen maximal in den Prompt
const MAX_HISTORY_TURNS = 8;           // wie viele Chat-Nachrichten gehen in den Prompt
const MAX_USER_MESSAGE_LENGTH = 2000;  // wie lang darf eine einzelne User-Nachricht Richtung Modell sein
const MAX_KNOWLEDGE_SUMMARY_LENGTH = 4000; // harte Kappung des Wissen-Blocks im Prompt
const MAX_HISTORY_SUMMARY_LENGTH = 2000;   // harte Kappung des Verlauf-Blocks im Prompt

// ------------------------------------------------------------
// SAFETY GUARD: Niemals versehentlich gegen echte Google APIs schreiben
// Wenn Functions Emulator läuft, MUSS Firestore Emulator aktiv sein.
// ------------------------------------------------------------
const isLikelyFunctionsEmulator =
  process.env.FUNCTIONS_EMULATOR === "true" ||
  !!process.env.FIREBASE_EMULATOR_HUB ||
  // firebase-tools setzt das oft in Emulator-Runs:
  !!process.env.FUNCTION_TARGET ||
  // sehr grob, aber in Emulator fast immer vorhanden:
  (process.env.GCLOUD_PROJECT === "anoraapp-ai" &&
    process.env.NODE_ENV !== "production");

if (isLikelyFunctionsEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "SAFETY GUARD: FIRESTORE_EMULATOR_HOST ist nicht gesetzt. " +
      "Du würdest gegen echte Google APIs/Firestore schreiben. " +
      "Starte: firebase emulators:start --only functions,firestore"
  );
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ------------------------------------------------------------
// Generische Meta-Helper für brain/{userId}/meta/{key}
// ------------------------------------------------------------
type MetaContextDoc = {
  updatedAt: number;
  [key: string]: any;
};

async function setMetaContext(
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

  // 🔍 zentrales Logging für ALLE Meta-Writes
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
  const ref = db
    .collection("brain")
    .doc(userId)
    .collection("meta")
    .doc(key);

  await ref.delete();

  // 🔍 zentrales Logging für Meta-Löschungen
  logger.info("meta_clear", {
    userId,
    metaKey: key,
  });
}


// ------------------------------------------------------------
// Spezielle Reset-Helper für einzelne Kontexte
// ------------------------------------------------------------

// Beispiel: Kontext "letzter Mieter" zurücksetzen
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



// ------------------------------------------------------------
// Helper: KI-JSON sicher extrahieren & parsen
// ------------------------------------------------------------

function fmt(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function extractJsonBlock(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return trimmed;

  // 0) Wenn die Antwort schon direkt mit { oder [ startet:
  // dann NICHT rum-schnippeln, sondern direkt zurückgeben.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // Optional: Falls ein ``` Block drumrum ist, wird das unten ohnehin behandelt,
    // aber hier sind wir meist schon fertig.
    return trimmed;
  }

  // 1) Codefence: ```json ... ``` oder ``` ... ```
  if (trimmed.includes("```")) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      const inside = match[1].trim();
      if (inside.startsWith("{") || inside.startsWith("[")) return inside;
      return inside;
    }
  }

  // 2) Finde ein JSON-Objekt im Text (erste { ... letzte })
  const firstObj = trimmed.indexOf("{");
  const lastObj = trimmed.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    return trimmed.slice(firstObj, lastObj + 1).trim();
  }

  // 3) Finde ein JSON-Array im Text (erste [ ... letzte ])
  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    return trimmed.slice(firstArr, lastArr + 1).trim();
  }

  // 4) Fallback
  return trimmed;
}

export function safeParseAssistantJson(raw: string): any | null {
  const jsonCandidate = extractJsonBlock(raw);

  try {
    return JSON.parse(jsonCandidate);
  } catch (err) {
    logger.error("safeParseAssistantJson_failed", {
      raw,
      jsonCandidate,
      error: String(err),
    });
    return null;
  }
}

// ------------------------------------------------------------
// Safety-Layer: BrainOutput serverseitig "härten"
// ------------------------------------------------------------
function sanitizeBrainOutput(output: BrainOutput): BrainOutput {
  // Reply absichern
  let reply =
    typeof output.reply === "string" ? output.reply : "";

  // harte Längenbegrenzung, falls das Modell eskaliert
  const MAX_REPLY_LENGTH = 2000;
  if (reply.length > MAX_REPLY_LENGTH) {
    logger.warn("anora_reply_truncated", {
      originalLength: reply.length,
      cappedAt: MAX_REPLY_LENGTH,
    });
    reply = reply.slice(0, MAX_REPLY_LENGTH);
  }

  // Fallback, falls die KI faktisch nichts Sinnvolles liefert
  if (!reply.trim()) {
    logger.warn("anora_empty_reply_fallback_used");
    reply = FALLBACK_COPY_DE.emptyReplyFallback;
  }

  // Arrays absichern
  const newFacts = Array.isArray(output.newFacts)
    ? output.newFacts
    : [];

  const actions = Array.isArray(output.actions)
    ? output.actions
    : [];

  const tasks = Array.isArray(output.tasks)
    ? output.tasks
    : [];

  return { reply, newFacts, actions, tasks };
}

// ------------------------------------------------------------
// Ausführen von BrainActions (z.B. Kontext-Resets)
// ------------------------------------------------------------
async function executeBrainActions(
  userId: string,
  actions: BrainAction[]
): Promise<void> {
  for (const action of actions) {
    if (action.type === "reset_context") {
  if (action.context === "tenant") {
    await resetTenantContext(userId);
  } else if (action.context === "property") {
    await resetPropertyContext(userId);
  } else if (action.context === "city") {
    await resetCityContext(userId);
  }
} else if (action.type === "set_context") {
  if (!action.value || typeof action.value !== "object") continue;

  if (action.context === "tenant") {
    await setTenantContext(userId, action.value);
  } else if (action.context === "property") {
    await setPropertyContext(userId, action.value);
  } else if (action.context === "city") {
    await setCityContext(userId, action.value);
  }
}
  }
}

// Lädt alle relevanten Kontexte aus brain/{userId}/meta/*
// tenant/property als Roh-Meta, city als bereinigter Mietrechts-Kontext,
// userProfile als bereinigtes Persönlichkeits-/Profil-Objekt
async function loadBrainContexts(userId: string): Promise<BrainContexts> {
  const [tenantCtx, propertyCtx, mietrechtCtx, userProfile, focusCtx] =
    await Promise.all([
      getMetaContext(userId, "tenantContext"),
      getMetaContext(userId, "propertyContext"),
      getMietrechtContextForUser(userId),
      getUserProfileForUser(userId),
      getFocusContextForUser(userId), // <- NEU
    ]);

    let propertyCtxFinal = propertyCtx as any;

if (!propertyCtxFinal) {
  try {
    const one = await getSingleLatestPropertySummaryFromCore(userId);
    if (one && one.display) {
      // Wir setzen KEIN Firestore-Meta dauerhaft (erstmal),
      // sondern geben es nur als Kontext an das Modell.
      propertyCtxFinal = {
        lastPropertyLabel: one.display,
        coreEntityId: one.entityId, // hilfreich fürs Debugging
      };
    }
  } catch (err) {
    logger.warn("loadBrainContexts_property_fallback_failed", {
      userId,
      error: String(err),
    });
  }
}

  return {
  tenant: (tenantCtx as any) ?? null,
  property: (propertyCtxFinal as any) ?? null,
  city: (mietrechtCtx as any) ?? null,
  userProfile: (userProfile as any) ?? null,
  focus: (focusCtx as any) ?? null,
};
}

async function getSingleLatestPropertySummaryFromCore(userId: string): Promise<{
  entityId: string;
  display: string | null;
  city: string | null;
  rent_cold: number | null;
} | null> {
  // Wir holen Summary-Facts aus facts_v1
  const items = await queryFacts(userId, {
    domain: "real_estate",
    key: "summary",
    limit: 50,
  });

  // nur “latest=true” (dein Generator setzt das)
  const latestOnes = items
    .map((x) => x.data)
    .filter((d: any) => d?.meta?.latest === true);

  // Wir wollen nur dann automatisch Kontext setzen, wenn genau 1 Property eindeutig ist
  const byEntity = new Map<string, any>();
  for (const d of latestOnes) {
    const eid = String(d.entityId || "").trim();
    if (!eid) continue;
    // Falls mehrere Summaries pro entity existieren, nehmen wir die erste (kommt schon updatedAt desc aus queryFacts)
    if (!byEntity.has(eid)) byEntity.set(eid, d);
  }

  if (byEntity.size !== 1) return null;

  const only = Array.from(byEntity.values())[0];
  const v = (only as any).value ?? {};

  return {
    entityId: String((only as any).entityId),
    display: typeof v.display === "string" ? v.display : null,
    city: typeof v.city === "string" ? v.city : null,
    rent_cold: typeof v.rent_cold === "number" ? v.rent_cold : null,
  };
}

// ------------------------------------------------------------
// Helper: Collections in Batches löschen (für großes Wissen)
// ------------------------------------------------------------
async function deleteAllDocsInCollection(colRef: any): Promise<void> {
  const batchSize = 300; // konservativ unter Firestore-Limit 500

  // Wir löschen immer wieder kleine Batches, bis nichts mehr da ist
  // (Pagination über limit() + Schleife)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await colRef.limit(batchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc: any) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
  }
}

// ------------------------------------------------------------
// Panic-Reset: komplettes Wissen eines Nutzers löschen
// (facts + meta) – NICHT aus dem Chat triggern!
// ------------------------------------------------------------
async function wipeUserKnowledge(userId: string): Promise<void> {
  const brainRef = db.collection("brain").doc(userId);

  // Facts löschen
  await deleteAllDocsInCollection(brainRef.collection("facts"));

  // Meta löschen (Kontexte, spätere Personality, Flags, etc.)
  await deleteAllDocsInCollection(brainRef.collection("meta"));
}

// ------------------------------------------------------------
// Persönlichkeits-Reset: nur personality-Meta löschen
// (heute noch Platzhalter, aber vorbereitet)
// ------------------------------------------------------------
async function resetUserPersonalityData(userId: string): Promise<void> {
  const personalityRef = db
    .collection("brain")
    .doc(userId)
    .collection("meta")
    .doc("personality");

  await personalityRef.delete().catch(() => {
    // Wenn das Dokument noch nicht existiert -> ignorieren
  });
}

// ------------------------------------------------------------
// Spezieller Wrapper: letzter Mieter (nutzt Meta-Helper)
// ------------------------------------------------------------

type TenantContext = {
  lastTenantName?: string;
};

type PropertyContext = {
  lastPropertyLabel?: string;
};

type FocusContext = {
  label?: string;       // kurze Bezeichnung, z.B. "Mieter Müller", "Projekt Waldhütte"
  kind?: string;        // grobe Kategorie, z.B. "tenant", "property", "projekt", "studium"
  referenceId?: string; // optionale Referenz-ID (z.B. Fact-ID, Ticket-ID, etc.)
  rawUserText?: string; // Originalbefehl, z.B. "merk dir den Mieter Müller als aktuell"
};

async function setLastTenantForUser(
  userId: string,
  tenantName: string
): Promise<void> {
  const ctx: TenantContext = { lastTenantName: tenantName };
  await setMetaContext(userId, "tenantContext", ctx);
}

async function getLastTenantForUser(userId: string): Promise<string | null> {
  const raw = await getMetaContext(userId, "tenantContext");
  if (!raw || !raw.lastTenantName) return null;
  return String(raw.lastTenantName);
}

async function setLastPropertyForUser(
  userId: string,
  propertyLabel: string
): Promise<void> {
  const ctx: PropertyContext = { lastPropertyLabel: propertyLabel };
  await setMetaContext(userId, "propertyContext", ctx);
}

async function getLastPropertyForUser(userId: string): Promise<string | null> {
  const raw = await getMetaContext(userId, "propertyContext");
  if (!raw || !raw.lastPropertyLabel) return null;
  return String(raw.lastPropertyLabel);
}

// Generischer Fokus-Kontext (frei nutzbar für beliebige Themen)
async function setFocusContextForUser(
  userId: string,
  ctx: FocusContext
): Promise<void> {
  const payload: Record<string, any> = {};

  if (typeof ctx.label === "string" && ctx.label.trim()) {
    payload.label = ctx.label.trim().slice(0, 200);
  }
  if (typeof ctx.kind === "string" && ctx.kind.trim()) {
    payload.kind = ctx.kind.trim().slice(0, 100);
  }
  if (typeof ctx.referenceId === "string" && ctx.referenceId.trim()) {
    payload.referenceId = ctx.referenceId.trim().slice(0, 200);
  }
  if (typeof ctx.rawUserText === "string" && ctx.rawUserText.trim()) {
    payload.rawUserText = ctx.rawUserText.trim().slice(0, 500);
  }

  // Wenn nichts Sinnvolles drin ist -> nichts schreiben
  if (Object.keys(payload).length === 0) return;

  await setMetaContext(userId, "focusContext", payload);
}

async function getFocusContextForUser(
  userId: string
): Promise<Record<string, any> | null> {

  const raw = await getMetaContext(userId, "focusContext");
  if (!raw) return null;

  const ctx: Record<string, any> = {};

  if (typeof raw.label === "string" && raw.label.trim()) {
    ctx.label = raw.label.trim();
  }
  if (typeof raw.kind === "string" && raw.kind.trim()) {
    ctx.kind = raw.kind.trim();
  }
  if (typeof raw.referenceId === "string" && raw.referenceId.trim()) {
    ctx.referenceId = raw.referenceId.trim();
  }
  if (typeof raw.rawUserText === "string" && raw.rawUserText.trim()) {
    ctx.rawUserText = raw.rawUserText.trim();
  }
  if (typeof raw.updatedAt === "number") {
    ctx.updatedAt = raw.updatedAt;
  }

  // Wenn das Objekt leer wäre, behandeln wir es wie "kein Kontext"
  return Object.keys(ctx).length > 0 ? ctx : null;
}

async function resetFocusContext(userId: string): Promise<void> {
  await clearMetaContext(userId, "focusContext");
}

type MietrechtContext = {
  lastCity?: string;
  lastPostal?: string;
  hasMietspiegel?: boolean;
  mietspiegelSource?: string;
};


async function setMietrechtContextForUser(
  userId: string,
  ctx: MietrechtContext
): Promise<void> {
  // wir verwenden weiter das Dokument "cityContext" als Speicherort
  await setMetaContext(userId, "cityContext", ctx);
}

async function getMietrechtContextForUser(
  userId: string
): Promise<MietrechtContext | null> {
  const raw = await getMetaContext(userId, "cityContext");
  if (!raw) return null;

  const result: MietrechtContext = {};

  if (typeof raw.lastCity === "string") {
    result.lastCity = raw.lastCity;
  }
  if (typeof raw.lastPostal === "string") {
    result.lastPostal = raw.lastPostal;
  }
  if (typeof raw.hasMietspiegel === "boolean") {
    result.hasMietspiegel = raw.hasMietspiegel;
  }
  if (typeof raw.mietspiegelSource === "string") {
    result.mietspiegelSource = raw.mietspiegelSource;
  }

  // wenn nichts Sinnvolles drin ist, behandeln wir es wie "kein Kontext"
  return Object.keys(result).length > 0 ? result : null;
}

type UserMetaProfile = {
  displayName?: string;    // Anzeigename, z.B. "Simon"
  role?: string;           // z.B. "Vermieter", "Investor"
  defaultCity?: string;    // z.B. "Berlin"
  defaultPostal?: string;  // z.B. "10115"
  notes?: string;          // Freitext, z.B. "mag knappe Antworten"

  createdAt?: number;      // gesetzt bei erster Anlage
  updatedAt?: number;      // letztes Update
};

async function getUserMetaProfileForUser(
  userId: string
): Promise<UserMetaProfile | null> {
  const raw = await getMetaContext(userId, "userProfile");
  if (!raw) return null;

  const { updatedAt, createdAt, ...rest } = raw;

  const profile: UserMetaProfile = {
    ...rest,
  };

  if (typeof createdAt === "number") {
    profile.createdAt = createdAt;
  }
  if (typeof updatedAt === "number") {
    profile.updatedAt = updatedAt;
  }

  // Wenn das Objekt leer ist → wie "kein Profil"
  return Object.keys(profile).length > 0 ? profile : null;
}

async function setUserMetaProfileForUser(
  userId: string,
  profileUpdate: Partial<UserMetaProfile>
): Promise<UserMetaProfile> {
  const now = Date.now();

  const existing = await getUserMetaProfileForUser(userId);

  const merged: UserMetaProfile = {
    ...(existing || {}),
    ...profileUpdate,
  };

  // createdAt nur beim ersten Mal setzen
  if (!existing?.createdAt) {
    merged.createdAt = now;
  } else {
    merged.createdAt = existing.createdAt;
  }

  merged.updatedAt = now;

  await setMetaContext(userId, "userProfile", merged as Record<string, any>);

  return merged;
}

// ------------------------------------------------------------
// User-Profil / Persönlichkeit (statischere Nutzerdaten)
// ------------------------------------------------------------
type UserProfile = {
  fullName?: string;         // z.B. "Simon"
  primaryCity?: string;      // z.B. "Berlin"
  investmentStyle?: "defensiv" | "balanciert" | "offensiv";
  riskTolerance?: "low" | "medium" | "high";
  notes?: string;            // kurze Freitext-Notizen (max. ~ein Absatz)
};

// User-Profil aus meta/personality bereinigt laden
async function getUserProfileForUser(
  userId: string
): Promise<UserProfile | null> {
  const raw = await getMetaContext(userId, "personality");
  if (!raw) return null;

  const profile: UserProfile = {};

  if (typeof raw.fullName === "string" && raw.fullName.trim()) {
    profile.fullName = raw.fullName.trim();
  }
  if (typeof raw.primaryCity === "string" && raw.primaryCity.trim()) {
    profile.primaryCity = raw.primaryCity.trim();
  }
  if (
    raw.investmentStyle === "defensiv" ||
    raw.investmentStyle === "balanciert" ||
    raw.investmentStyle === "offensiv"
  ) {
    profile.investmentStyle = raw.investmentStyle;
  }
  if (
    raw.riskTolerance === "low" ||
    raw.riskTolerance === "medium" ||
    raw.riskTolerance === "high"
  ) {
    profile.riskTolerance = raw.riskTolerance;
  }
  if (typeof raw.notes === "string" && raw.notes.trim()) {
    // zur Sicherheit etwas härten, damit kein Roman reinkommt
    profile.notes = raw.notes.trim().slice(0, 500);
  }

  return Object.keys(profile).length > 0 ? profile : null;
}

// User-Profil in meta/personality updaten (Patch, kein Hard-Replace)
async function setUserProfileForUser(
  userId: string,
  patch: UserProfile
): Promise<void> {
  const payload: Record<string, any> = {};

  if (typeof patch.fullName === "string" && patch.fullName.trim()) {
    payload.fullName = patch.fullName.trim();
  }
  if (typeof patch.primaryCity === "string" && patch.primaryCity.trim()) {
    payload.primaryCity = patch.primaryCity.trim();
  }
  if (
    patch.investmentStyle === "defensiv" ||
    patch.investmentStyle === "balanciert" ||
    patch.investmentStyle === "offensiv"
  ) {
    payload.investmentStyle = patch.investmentStyle;
  }
  if (
    patch.riskTolerance === "low" ||
    patch.riskTolerance === "medium" ||
    patch.riskTolerance === "high"
  ) {
    payload.riskTolerance = patch.riskTolerance;
  }
  if (typeof patch.notes === "string" && patch.notes.trim()) {
    payload.notes = patch.notes.trim().slice(0, 500);
  }

  // Wenn nichts Sinnvolles drin ist -> nichts schreiben
  if (Object.keys(payload).length === 0) return;

  await setMetaContext(userId, "personality", payload);
}



// Presence-Einstellungen im Meta-Bereich
type PresenceIntensity = "low" | "medium" | "high";

async function getPresenceSettingsForUser(
  userId: string
): Promise<{
  enabled: boolean;
  intensity: PresenceIntensity;
  topicMuteUntil: Record<string, number>;
}> {
  const doc = await getMetaContext(userId, "presenceSettings");

  // Defaults
  let enabled = true;
  let intensity: PresenceIntensity = "medium";
  const topicMuteUntil: Record<string, number> = {};

  if (doc) {
    if (typeof doc.enabled === "boolean") {
      enabled = doc.enabled;
    }

    if (
      typeof doc.intensity === "string" &&
      (doc.intensity === "low" ||
        doc.intensity === "medium" ||
        doc.intensity === "high")
    ) {
      intensity = doc.intensity;
    }

    if (doc.topicMuteUntil && typeof doc.topicMuteUntil === "object") {
      for (const [key, value] of Object.entries(doc.topicMuteUntil)) {
        if (typeof value === "number") {
          topicMuteUntil[key] = value;
        }
      }
    }
  }

  return { enabled, intensity, topicMuteUntil };
}

async function isPresenceEnabledForUser(userId: string): Promise<boolean> {
  const { enabled } = await getPresenceSettingsForUser(userId);
  return enabled;
}

async function setPresenceEnabledForUser(
  userId: string,
  enabled: boolean
): Promise<void> {
  await setMetaContext(userId, "presenceSettings", { enabled });
}



// ---- OpenAI Setup ----
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  logger.error(
    "OPENAI_API_KEY ist NICHT gesetzt. Bitte .env im functions-Ordner prüfen."
  );
}

const openai = new OpenAI({
  apiKey: apiKey || "",
});

const llmBrainDeps = {
  openai,
  model: "gpt-4o-mini",
  systemPrompt: SYSTEM_PROMPT_DE,
  systemPromptVersion: SYSTEM_PROMPT_DE_VERSION,

  maxFactsPerPrompt: MAX_FACTS_PER_PROMPT,
  maxKnowledgeSummaryLength: MAX_KNOWLEDGE_SUMMARY_LENGTH,
  maxHistoryTurns: MAX_HISTORY_TURNS,
  maxHistorySummaryLength: MAX_HISTORY_SUMMARY_LENGTH,
  maxUserMessageLength: MAX_USER_MESSAGE_LENGTH,

  safeParseAssistantJson,
  validateIngestFacts,

  fallbackCopy: FALLBACK_COPY_DE,
} as const;

// 💡 Basis-Shape, den alle Facts teilen können
interface BaseFactData {
  id?: string; // interne ID, falls vorhanden
  label?: string; // kurze Bezeichnung
  notes?: string; // Freitext-Notizen
}

// 💡 Immobilien-Fact
export interface PropertyFactData extends BaseFactData {
  street?: string;
  houseNumber?: string;
  zipCode?: string;
  city?: string;
  country?: string;
  type?:
    | "wohnhaus"
    | "gewerbe"
    | "gemischt"
    | "grundstück"
    | "sonstiges";
  unitsResidential?: number;
  unitsCommercial?: number;
  yearBuilt?: number;
}

// 💡 Vertragsdaten für Mieter
export interface TenantContractData {
  type?: "index" | "staffel" | "gesetzlich" | "sonstiges";
  startDate?: string; // ISO-String
  lastIncrease?: string; // ISO-String oder Text
  baseIndex?: number | string; // z.B. 2020 = 100
}

// 💡 Mieter-Fact
export interface TenantFactData extends BaseFactData {
  name?: string; // bevorzugt
  person?: string; // fallback, falls Modell das Feld nutzt
  propertyId?: string; // Referenz auf Property-Fact.id
  unitLabel?: string; // z.B. "Laden rechts", "3. OG links"

  // Mieten
  coldRent?: number; // Kaltmiete
  serviceCharge?: number; // Nebenkosten/Vorauszahlung
  warmRent?: number; // Warmmiete (ohne MwSt)

  // MwSt
  hasVat?: boolean;
  vatRate?: number; // z.B. 0.19

  contract?: TenantContractData;

  // optionale Risiko-/Statusinfos
  riskLevel?: "low" | "medium" | "high";
  riskNotes?: string;
}

// 💡 Termin-/Event-Fact
export interface EventFactData extends BaseFactData {
  date?: string; // ISO-Datum oder DateTime
  time?: string;
  endDate?: string;
  location?: string;
  eventType?:
    | "besichtigung"
    | "handwerker"
    | "mietertermin"
    | "verwaltung"
    | "sonstiges";
  relatedPropertyId?: string;
  relatedTenantId?: string;
}

// 💡 Personen-Fact (Familie, Handwerker, Ansprechpartner, etc.)
export interface PersonFactData extends BaseFactData {
  fullName?: string;
  role?: string; // z.B. "Handwerker", "Steuerberater", "Mieter"
  phone?: string;
  email?: string;
  company?: string;
  city?: string;
}

// 💡 Generische Facts – alles, was sonst nirgends sauber passt
export interface GenericFactData extends BaseFactData {
  category?: string;
  payload?: Record<string, any>;
}

// Sammeltyp für alle möglichen Datenformen
export type AnyFactData =
  | PropertyFactData
  | TenantFactData
  | EventFactData
  | PersonFactData
  | GenericFactData
  | Record<string, any>; // Fallback, damit nichts kaputt geht

// ------------------------------------------------------------
// Presence-Kandidaten (Anora Presence v1)
// ------------------------------------------------------------
type PresenceCandidateCategory = "risk" | "money" | "project" | "other";

type PresenceCandidate = {
  category: PresenceCandidateCategory;
  event: PresenceEventInput;
};

// einfache Keyword-Listen für Heuristiken (v1, bewusst simpel)
const STRESS_KEYWORDS = [
  "stress",
  "gestresst",
  "überfordert",
  "überlastet",
  "druck",
  "streit",
  "konflikt",
  "ärger",
  "eskaliert",
  "panik",
  "angst",
];

const MONEY_DECISION_KEYWORDS = [
  "kauf",
  "kaufen",
  "verkauf",
  "verkaufen",
  "finanzierung",
  "finanzieren",
  "finanzierungs",
  "kredit",
  "darlehen",
  "hypothek",
  "zins",
  "zinsen",
  "rate",
  "raten",
  "tilgung",
  "invest",
  "investition",
  "angebot",
  "notar",
  "kosten",
  "teuer",
];

// Themen, bei denen Presence v1 NICHT anspringen soll
// (Beziehung, Einsamkeit, Depression, etc.)
const EMOTIONAL_NO_GO_KEYWORDS = [
  "einsam",
  "einsamkeit",
  "alleine",
  "allein",
  "depressiv",
  "depression",
  "depri",
  "traurig",
  "hoffnungslos",
  "lebensmüde",
  "selbstmord",
  "suizid",
  "trennung",
  "schluss gemacht",
  "beziehung",
  "partner",
  "partnerin",
  "freundin",
  "freund",
  "liebeskummer",
  "herzschmerz",
];

// ------------------------------------------------------------
// 3.1 – Einfache Regel-Trigger (aus Chat + Tasks)
// ------------------------------------------------------------
function collectPresenceCandidatesFromChat(
  input: BrainInput,
  result: BrainOutput
): PresenceCandidate[] {
  const candidates: PresenceCandidate[] = [];

  const msg = (input.message || "").toLowerCase();
  const lastUserTexts = input.history
    .filter((m) => m.role === "user")
    .slice(-5)
    .map((m) => m.text.toLowerCase());

  const combinedUserText = [msg, ...lastUserTexts].join(" \n ");

  // 3.1.3 – Basis-Logging für Presence-Check
  logger.info("presence_check_start", {
    userId: input.userId,
    currentMessage: input.message,
    combinedUserText,
  });

  // ❌ 6.1 – No-Go-Zonen: rein emotionale / Beziehungs-Themen
  const hasEmotionalNoGo = EMOTIONAL_NO_GO_KEYWORDS.some((kw) =>
    combinedUserText.includes(kw)
  );

  // kleine Whitelist: wenn es ganz offensichtlich um Miete / Immobilien / Geld geht,
  // darf Presence trotzdem arbeiten – auch wenn jemand schreibt
  // "die Beziehung stresst mich UND ich kriege die Finanzierung nicht hin"
  const TECH_OR_DECISION_KEYWORDS = [
  "miete",
  "mieter",
  "objekt",
  "wohnung",
  "haus",
  "immobilie",
  "gebäude",
  "kauf",
  "verkauf",
  "kaufen",
  "verkaufen",
  "finanzierung",
  "finanzieren",
  "finanzierungs",
  "kredit",
  "darlehen",
  "hypothek",
  "zins",
  "zinsen",
  "rate",
  "raten",
  "tilgung",
  "bank",
  "angebot",
  "notar",
  "abrechnung",
  "verwaltung",
  "steuer",
  "kosten",
  "teuer",
];

  const hasHardDecisionContext = TECH_OR_DECISION_KEYWORDS.some((kw) =>
    combinedUserText.includes(kw)
  );

  if (hasEmotionalNoGo && !hasHardDecisionContext) {
    // Presence v1 hält sich hier komplett raus
    logger.info("presence_skipped_emotional_topic", {
      userId: input.userId,
    });
    return [];
  }

  // A) Stress-/Konflikt-Hinweis (Kategorie "risk")
  let stressHits = 0;
  for (const kw of STRESS_KEYWORDS) {
    if (combinedUserText.includes(kw)) {
      stressHits++;
    }
  }

  if (stressHits >= 2) {
    candidates.push({
      category: "risk",
      event: {
        type: "stress_hint",
        topic: "stress",
        message: PRESENCE_COPY_DE.stress_hint.message,
        source: "pattern_stress",
        metadata: {
          stressHits,
        },
      },
    });
  }

  // B) Entscheidungs-/Geld-Hinweis (Kategorie "money")
  let moneyHits = 0;
  for (const kw of MONEY_DECISION_KEYWORDS) {
    if (combinedUserText.includes(kw)) {
      moneyHits++;
    }
  }

  if (moneyHits >= 1) {
    candidates.push({
      category: "money",
      event: {
        type: "decision_followup",
        topic: "finance_decision",
        message: PRESENCE_COPY_DE.decision_followup.message,
        source: "pattern_decision",
        metadata: {
          moneyHits,
        },
      },
    });
  }

  // 3.1.3 – Detektions-Logging
  logger.info("presence_detected_patterns", {
    userId: input.userId,
    stressHits,
    moneyHits,
    hasEmotionalNoGo,
  });

  // C) Projekt-/Task-Nudge (Kategorie "project")
  const hasTodoTask = (result.tasks || []).some(
    (t) => t.type === "todo" || t.type === "manual_risk_check"
  );

  if (hasTodoTask) {
    candidates.push({
      category: "project",
      event: {
        type: "project_nudging",
        topic: "project",
        message: PRESENCE_COPY_DE.project_nudging.message,
        source: "task_todo",
      },
    });
  }

  // D) Wenn nichts erkannt wurde → keine Presence
  return candidates;
}

// ------------------------------------------------------------
// Presence-Events (Anora Presence v1)
// ------------------------------------------------------------
type PresenceEventType =
  | "project_nudging"    // sanfter Schubs bei Projekten / offenen Themen
  | "decision_followup"  // Nachfassen bei wichtigen Entscheidungen
  | "stress_hint"        // dezenter Hinweis auf Belastungsklumpen
  | "generic";           // sonstige, neutrale Präsenz-Hinweise

type PresenceEventSource =
  | "task_todo"          // aus offenen To-dos abgeleitet
  | "task_manual_risk"   // aus manuellen Risiko-Checks
  | "pattern_decision"   // Muster in Entscheidungen / Objekten
  | "pattern_stress"     // Muster in Konflikt- / Stress-Sprache
  | "manual";            // manuell / spätere Spezialfälle

type PresenceEventStatus =
  | "pending"            // erzeugt, noch nicht gezeigt
  | "shown"              // im Frontend angezeigt
  | "dismissed"          // vom Nutzer weggeklickt / ignoriert
  | "snoozed";           // auf später verschoben

  

  type PresenceTopic =
  | "stress"
  | "finance_decision"
  | "project"
  | "generic"
  | "stress_cluster"
  | "money_decision"
  | "project_followup"
  | "location_watch"
  | "other";         // alles andere

type PresenceEventDoc = {
  type: PresenceEventType;
  topic?: PresenceTopic;          // <- NEU
  message: string;                // der eine Satz, der im UI angezeigt wird
  source?: PresenceEventSource;   // technisch: woher kommt der Impuls
  linkedTaskId?: string | null;   // optional Verknüpfung zu einem Task

  createdAt: number;              // wann erzeugt
  shownAt?: number | null;        // wann zum ersten Mal angezeigt
  dismissedAt?: number | null;    // wann aktiv verworfen
  snoozedUntil?: number | null;   // bis wann snooze gilt

  status: PresenceEventStatus;    // aktueller Status
  metadata?: Record<string, any>; // optional zusätzliche Infos (z.B. Objekt-ID)
};

function isEmergencyPresenceEvent(
  event: PresenceEventInput | PresenceEventDoc
): boolean {
  const meta = event.metadata || {};

  // Harte Flags
  if (meta.isEmergency === true) return true;
  if (meta.severity === "critical") return true;

  // Optional: einfache Heuristik – z.B. sehr viele Stress-Hits
  if (
    event.type === "stress_hint" &&
    typeof meta.stressHits === "number" &&
    meta.stressHits >= 5
  ) {
    return true;
  }

  return false;
}

// Input-Typ für Erzeugung (createdAt/status werden gesetzt)
type PresenceEventInput = {
  type: PresenceEventType;
  topic?: PresenceTopic;          // <- NEU
  message: string;
  source?: PresenceEventSource;
  linkedTaskId?: string | null;
  shownAt?: number | null;
  dismissedAt?: number | null;
  snoozedUntil?: number | null;
  status?: PresenceEventStatus;
  metadata?: Record<string, any>;
};

function inferPresenceTopicsForEvent(
  event: PresenceEventInput | PresenceEventDoc
): PresenceTopic[] {
  const topics: PresenceTopic[] = [];

  // 1) Hauptlogik über type
  if (event.type === "stress_hint") {
    topics.push("stress_cluster");
  } else if (event.type === "decision_followup") {
    topics.push("money_decision");
  } else if (event.type === "project_nudging") {
    topics.push("project_followup");
  } else {
    topics.push("other");
  }

  // 2) Zusatz: wenn Location-Hinweis vorhanden → location_watch ergänzen
  const meta = (event as any).metadata || {};
  if (
    (typeof meta.locationHint === "string" && meta.locationHint.trim()) ||
    (typeof meta.address === "string" && meta.address.trim())
  ) {
    if (!topics.includes("location_watch")) {
      topics.push("location_watch");
    }
  }

  return topics;
}

type PresenceTopicMeta = {
  blockedUntil?: number;
  lastDisabledAt?: number;
};

// schlankere Map: nicht alle Topics müssen zwingend Keys haben
type PresenceTopicMetaMap = Partial<Record<PresenceTopic, PresenceTopicMeta>>;

async function getPresenceTopicMeta(
  userId: string
): Promise<PresenceTopicMetaMap> {
  const doc = await getMetaContext(userId, "presenceTopics");
  if (!doc) return {};

  const result: PresenceTopicMetaMap = {};

  for (const key of Object.keys(doc)) {
    if (key === "updatedAt") continue;
    const value = (doc as any)[key];
    if (!value || typeof value !== "object") continue;

    const topic = key as PresenceTopic;
    const blockedUntil =
      typeof value.blockedUntil === "number" ? value.blockedUntil : undefined;
    const lastDisabledAt =
      typeof value.lastDisabledAt === "number"
        ? value.lastDisabledAt
        : undefined;

    result[topic] = { blockedUntil, lastDisabledAt };
  }

  return result;
}

async function updatePresenceTopicMeta(
  userId: string,
  topic: PresenceTopic,
  blockedUntil: number,
  lastDisabledAt: number
): Promise<void> {
  const payload: PresenceTopicMetaMap = {
    [topic]: {
      blockedUntil,
      lastDisabledAt,
    },
  };

  // nutzt deinen generischen Meta-Helper, wird sauber gemergt
  await setMetaContext(userId, "presenceTopics", payload as Record<string, any>);
}

// ------------------------------------------------------------
// Firestore: Wissen laden (CORE facts_v1) -> Legacy-kompatibel für runServerBrain
// ------------------------------------------------------------
async function loadKnowledge(userId: string): Promise<BrainFactDoc[]> {
  const items = await queryFacts(userId, { domain: "real_estate", limit: 300 });
  const facts = items.map((x) => x.data);
  return mapRealEstateFactsToLegacyKnowledge({ userId, facts }) as any;
}

// ------------------------------------------------------------
// Firestore: Neues Wissen speichern
// ------------------------------------------------------------
// LEGACY – DO NOT USE FOR CORE MEMORY
// BrainFacts are transient. Persistent memory lives in facts_v1 only.
export async function saveNewFacts(userId: string, facts: BrainFactInput[]) {
  if (!facts || facts.length === 0) return;

  const col = db.collection("brain").doc(userId).collection("facts");
  const batch = db.batch();
  const now = Date.now();

  for (const fact of facts) {
    const ref = col.doc();
    batch.set(ref, {
      type: fact.type || "generic",
      tags: Array.isArray(fact.tags) ? fact.tags : [],
      data: fact.data ?? {},
      raw: fact.raw ?? "",
      createdAt: now,
      userId,
    });
  }

  await batch.commit();
}

// ------------------------------------------------------------
// Mietrechts-Kontext aus neuen Facts / Dokument-Meta ableiten
// ------------------------------------------------------------
export async function updateMietrechtContextFromFacts(
  userId: string,
  facts: BrainFactInput[],
  options?: { filename?: string | null; source?: string | null }
): Promise<void> {
  if (!facts || facts.length === 0) {
    // kann trotzdem sinnvoll sein, wenn nur Mietspiegel-Datei erkannt wird
  }

  let lastCity: string | undefined;
  let lastPostal: string | undefined;

  for (const fact of facts) {
    if (!fact || typeof fact !== "object") continue;
    if (fact.type !== "property" && fact.type !== "tenant") continue;

    const d: any = fact.data ?? {};

    // Stadt
    if (!lastCity && typeof d.city === "string" && d.city.trim()) {
      lastCity = d.city.trim();
    }

    // PLZ – verschiedene mögliche Feldnamen abfangen
    if (!lastPostal) {
      const postal =
        (typeof d.zipCode === "string" && d.zipCode.trim()) ||
        (typeof d.postal === "string" && d.postal.trim()) ||
        (typeof d.plz === "string" && d.plz.trim());
      if (postal) {
        lastPostal = postal;
      }
    }
  }

  // Mietspiegel-Erkennung aus Dateinamen/Quelle (für ingestDocumentText)
  let hasMietspiegel: boolean | undefined;
  let mietspiegelSource: string | undefined;

  const filename = options?.filename ?? undefined;
  const source = options?.source ?? undefined;
  const nameForDetection = (filename || source || "").toLowerCase();

  if (nameForDetection.includes("mietspiegel")) {
    hasMietspiegel = true;
    mietspiegelSource = filename || source;
  }

  // Wenn wir weder Stadt/PLZ noch Mietspiegel-Info haben → nichts tun
  if (!lastCity && !lastPostal && hasMietspiegel === undefined) {
    return;
  }

  const payload: MietrechtContext = {};
  if (lastCity) payload.lastCity = lastCity;
  if (lastPostal) payload.lastPostal = lastPostal;
  if (hasMietspiegel !== undefined) payload.hasMietspiegel = hasMietspiegel;
  if (mietspiegelSource) payload.mietspiegelSource = mietspiegelSource;

  try {
    await setMietrechtContextForUser(userId, payload);
    logger.info("mietrechtContext_updated_from_facts", {
      userId,
      lastCity,
      lastPostal,
      hasMietspiegel,
      mietspiegelSource,
    });
  } catch (err) {
    logger.error("mietrechtContext_update_failed", {
      userId,
      error: String(err),
    });
  }
}

// ------------------------------------------------------------
// Property-Kontext aus neuen Facts ableiten (1.2/3)
// ------------------------------------------------------------
function buildPropertyLabelFromFact(fact: BrainFactInput): string | null {
  if (fact.type !== "property") return null;

  const data = (fact.data || {}) as PropertyFactData;

  // 1) Explizites Label bevorzugen
  if (typeof data.label === "string" && data.label.trim().length > 0) {
    return data.label.trim();
  }

  // 2) Aus Adresse bauen: "Straße Nr, PLZ Stadt"
  const parts: string[] = [];

  const streetParts: string[] = [];
  if (data.street && data.street.trim()) streetParts.push(data.street.trim());
  if (data.houseNumber && String(data.houseNumber).trim()) {
    streetParts.push(String(data.houseNumber).trim());
  }
  if (streetParts.length > 0) {
    parts.push(streetParts.join(" "));
  }

  const cityParts: string[] = [];
  if (data.zipCode && String(data.zipCode).trim()) {
    cityParts.push(String(data.zipCode).trim());
  }
  if (data.city && data.city.trim()) {
    cityParts.push(data.city.trim());
  }
  if (cityParts.length > 0) {
    parts.push(cityParts.join(" "));
  }

  if (parts.length > 0) {
    return parts.join(", ");
  }

  // 3) Fallback: kurzer Ausschnitt aus raw-Text
  if (typeof fact.raw === "string" && fact.raw.trim()) {
    return fact.raw.trim().slice(0, 80);
  }

  return null;
}

async function updatePropertyContextFromNewFacts(
  userId: string,
  facts: BrainFactInput[]
): Promise<void> {
  if (!facts || facts.length === 0) return;

  // nur property-Facts relevant
  const propertyFacts = facts.filter((f) => f.type === "property");
  if (propertyFacts.length === 0) return;

  // wir nehmen den letzten property-Fact der aktuellen Antwort
  const lastPropertyFact = propertyFacts[propertyFacts.length - 1];
  const label = buildPropertyLabelFromFact(lastPropertyFact);
  if (!label) return;

  try {
    await setLastPropertyForUser(userId, label);
  } catch (err) {
    logger.error("updatePropertyContextFromNewFacts_failed", {
      userId,
      error: String(err),
    });
  }
}

// ------------------------------------------------------------
// Firestore: Presence-Event anlegen (Anora Presence v1)
// ------------------------------------------------------------
async function createPresenceEvent(
  userId: string,
  input: PresenceEventInput
): Promise<string> {
  const col = db
    .collection("brain")
    .doc(userId)
    .collection("presenceEvents");

  const ref = col.doc();
  const now = Date.now();

  const metadata =
    input.metadata && typeof input.metadata === "object"
      ? input.metadata
      : {};

  // Themen ableiten (z.B. stress_cluster, money_decision, location_watch, ...)
  const topics = inferPresenceTopicsForEvent({
    type: input.type,
    message: input.message,
    source: input.source,
    linkedTaskId: input.linkedTaskId ?? null,
    createdAt: now,
    shownAt: input.shownAt ?? null,
    dismissedAt: input.dismissedAt ?? null,
    snoozedUntil: input.snoozedUntil ?? null,
    status: input.status ?? "pending",
    metadata,
  });

  // "Primäres" Topic: entweder explizit gesetzt oder erstes abgeleitetes
  const primaryTopic =
    (input.topic && typeof input.topic === "string" && input.topic) ||
    topics[0] ||
    "other";

  const doc: PresenceEventDoc = {
    type: input.type,
    topic: primaryTopic,
    // harte Längenbegrenzung auf z.B. 500 Zeichen – Presence ist kurz
    message:
      typeof input.message === "string"
        ? input.message.slice(0, 500)
        : "",
    source: input.source,
    linkedTaskId: input.linkedTaskId ?? null,

    createdAt: now,
    shownAt: input.shownAt ?? null,
    dismissedAt: input.dismissedAt ?? null,
    snoozedUntil: input.snoozedUntil ?? null,

    status: input.status ?? "pending",
    metadata,
  };

  await ref.set(doc);
  return ref.id;
}

// ... createPresenceEvent (wie oben)

// ------------------------------------------------------------
// Firestore: Presence-Event Status aktualisieren
// ------------------------------------------------------------
async function updatePresenceEventStatus(
  userId: string,
  eventId: string,
  updates: {
    status?: PresenceEventStatus;
    shownAt?: number | null;
    dismissedAt?: number | null;
    snoozedUntil?: number | null;
  }
): Promise<void> {
  const ref = db
    .collection("brain")
    .doc(userId)
    .collection("presenceEvents")
    .doc(eventId);

  const payload: Record<string, any> = {};

  if (typeof updates.status === "string") {
    payload.status = updates.status;
  }
  if (updates.shownAt !== undefined) {
    payload.shownAt = updates.shownAt;
  }
  if (updates.dismissedAt !== undefined) {
    payload.dismissedAt = updates.dismissedAt;
  }
  if (updates.snoozedUntil !== undefined) {
    payload.snoozedUntil = updates.snoozedUntil;
  }

  if (Object.keys(payload).length === 0) {
    // nichts zu updaten
    return;
  }

  await ref.set(payload, { merge: true });
}

// ------------------------------------------------------------
// Presence: Rate-Limits & Loader
// ------------------------------------------------------------

const MAX_PRESENCE_EVENTS_PER_WEEK = 50; // globaler Hard-Cap pro Nutzer und Woche

function getPresenceRateLimits(
  intensity: PresenceIntensity
): { maxPerWeek: number; minHoursBetween: number } {
  // ⚠️ DEV-Phase: Limits stark gelockert, damit du Presence sauber testen kannst.
  // Für echte Produktion später wieder konservativer einstellen.
  switch (intensity) {
    case "low":
      return {
        maxPerWeek: 5,
        minHoursBetween: 24, // max 1/Tag
      };
    case "high":
      return {
        maxPerWeek: 100,
        minHoursBetween: 0.5, // 30 Minuten Abstand
      };
    case "medium":
    default:
      return {
        maxPerWeek: 50,
        minHoursBetween: 1, // 1 Stunde Abstand
      };
  }
}

// ------------------------------------------------------------
// ... dein vorhandener Code mit MAX_PRESENCE_EVENTS_PER_WEEK etc.



// Hilfsfunktion: letzte Presence-Events eines Nutzers laden
async function loadRecentPresenceEvents(
  userId: string,
  sinceMillis: number
): Promise<PresenceEventDoc[]> {
  const col = db
    .collection("brain")
    .doc(userId)
    .collection("presenceEvents");

  const snap = await col
    .where("createdAt", ">=", sinceMillis)
    .orderBy("createdAt", "desc")
    .get();

  return snap.docs.map((d) => d.data() as PresenceEventDoc);
}


// 3.3 – Auswahl des "Top"-Presence-Kandidaten
// Priorität: Risiko > Geld > Projekte > Sonstiges
function pickTopPresenceCandidate(
  candidates: PresenceCandidate[]
): PresenceCandidate | null {
  if (!candidates || candidates.length === 0) return null;

  const priorityOrder: PresenceCandidateCategory[] = [
    "risk",
    "money",
    "project",
    "other",
  ];

  for (const cat of priorityOrder) {
    const inCat = candidates.filter((c) => c.category === cat);
    if (inCat.length > 0) {
      return inCat[0];
    }
  }

  return null;
}

// 3.2 + 3.3 – Rate-Limit anwenden und genau EINE Presence erzeugen (wenn sinnvoll)
async function generatePresenceFromChatIfAllowed(
  userId: string,
  input: BrainInput,
  result: BrainOutput
): Promise<void> {
  // 0) Presence-Settings laden (Opt-out + Intensität)
  const { enabled, intensity } = await getPresenceSettingsForUser(userId);

  if (!enabled) {
    logger.info("presence_opt_out_active", { userId });
    return;
  }

  const rateLimits = getPresenceRateLimits(intensity);
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  // 1) Kandidaten aus Chat + Tasks sammeln
  const candidates = collectPresenceCandidatesFromChat(input, result);
  if (!candidates || candidates.length === 0) {
    return;
  }

  // 2) Top-Kandidaten nach Priorität auswählen
  const top = pickTopPresenceCandidate(candidates);
  if (!top) return;

  const eventInput = top.event;

  // 2a) Thema ableiten (explizit oder aus Event-Typ)
  const primaryTopic: PresenceTopic =
    eventInput.topic ??
    inferPresenceTopicsForEvent({
      type: eventInput.type,
      message: eventInput.message,
      source: eventInput.source,
      linkedTaskId: eventInput.linkedTaskId ?? null,
      createdAt: now,
      shownAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      status: eventInput.status ?? "pending",
      metadata: eventInput.metadata ?? {},
    })[0] ??
    "other";

  // 2b) Themen-Block prüfen (z.B. nach "disable" für 90 Tage)
  const topicMeta = await getPresenceTopicMeta(userId);
  const topicState = topicMeta[primaryTopic];

  if (
    topicState &&
    typeof topicState.blockedUntil === "number" &&
    topicState.blockedUntil > now
  ) {
    logger.info("presence_topic_block_active", {
      userId,
      topic: primaryTopic,
      blockedUntil: topicState.blockedUntil,
    });
    return;
  }

  const isEmergency = isEmergencyPresenceEvent(eventInput);

  // 3) Bisherige Presence-Events der letzten Woche laden
  const recentEvents = await loadRecentPresenceEvents(userId, oneWeekAgo);

  // 3a) Globaler Hard-Cap pro Woche (z.B. 50)
  if (recentEvents.length >= MAX_PRESENCE_EVENTS_PER_WEEK) {
    logger.info("presence_rate_limit_weekly_block_global", {
      userId,
      recentCount: recentEvents.length,
      maxPerWeek: MAX_PRESENCE_EVENTS_PER_WEEK,
      intensity,
      isEmergency,
    });
    // Auch Notfälle werden hier gestoppt – absoluter Schutz
    return;
  }

  // 3b) Intensitätsabhängige Limits – nur für NICHT-Notfälle
  if (!isEmergency) {
    const { maxPerWeek, minHoursBetween } = rateLimits;

    // Wochenlimit pro Intensität
    if (recentEvents.length >= maxPerWeek) {
      logger.info("presence_rate_limit_weekly_block_intensity", {
        userId,
        intensity,
        recentCount: recentEvents.length,
        maxPerWeek,
      });
      return;
    }

    // Min. Abstand zwischen zwei Events
    const latest = recentEvents[0];
    if (latest) {
      const diffHours = (now - latest.createdAt) / (1000 * 60 * 60);
      if (diffHours < minHoursBetween) {
        logger.info("presence_rate_limit_spacing_block", {
          userId,
          intensity,
          lastEventAt: latest.createdAt,
          diffHours,
          requiredMinHours: minHoursBetween,
        });
        return;
      }
    }
  } else {
    // Optional: explizit loggen, dass wir Limits für Notfall übergehen
    logger.info("presence_emergency_bypass_limits", {
      userId,
      intensity,
      type: eventInput.type,
      source: eventInput.source ?? null,
    });
  }

  // 4) Presence-Event schreiben
  const eventId = await createPresenceEvent(userId, eventInput);

  logger.info("presence_event_created", {
    userId,
    eventId,
    category: top.category,
    type: eventInput.type,
    source: eventInput.source ?? null,
    intensity,
    isEmergency,
  });
}



// ------------------------------------------------------------
// KI-Hauptfunktion – hier spricht Anora
// ------------------------------------------------------------
async function runServerBrain(
  input: BrainInput,
  core?: { intervention?: { level: string; reasonCodes: string[] } }
): Promise<BrainOutput> {
  if (!apiKey) {
    return {
      reply: FALLBACK_COPY_DE.missingApiKey,
      newFacts: [],
      actions: [],
      tasks: [],
    };
  }

  const { userId, userName, message, knowledge, history, contexts } = input;

  const namePart = userName ? `Der Nutzer heißt ${userName}.` : "";

  // Wissen begrenzen (Anzahl + Länge)
  const knowledgeSummaryRaw =
    knowledge.length === 0
      ? "Bisher sind noch keine Fakten gespeichert."
      : knowledge
          .slice(-MAX_FACTS_PER_PROMPT)
          .map((f) => {
            const raw = f.raw || "";
            const t = f.type || "generic";
            return `• [${t}] ${raw}`;
          })
          .join("\n");

  const knowledgeSummary =
    knowledgeSummaryRaw.length > MAX_KNOWLEDGE_SUMMARY_LENGTH
      ? knowledgeSummaryRaw.slice(0, MAX_KNOWLEDGE_SUMMARY_LENGTH) +
        "\n[GEKÜRZT]"
      : knowledgeSummaryRaw;

  // Verlauf begrenzen (Anzahl + Länge)
  const lastTurnsRaw =
    history.length === 0
      ? "Noch kein bisheriger Chatverlauf."
      : history
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => `${m.role === "user" ? "Nutzer" : "Anora"}: ${m.text}`)
          .join("\n");

  const lastTurns =
    lastTurnsRaw.length > MAX_HISTORY_SUMMARY_LENGTH
      ? lastTurnsRaw.slice(0, MAX_HISTORY_SUMMARY_LENGTH) + "\n[GEKÜRZT]"
      : lastTurnsRaw;

  // Nutzer-Nachricht begrenzen (für das Modell, nicht für Speicherung)
  const truncatedMessage =
    typeof message === "string"
      ? message.slice(0, MAX_USER_MESSAGE_LENGTH)
      : "";

  const contextSummaryLines: string[] = [];

  // Tenant-Kontext (letzter Mieter)
  if (contexts?.tenant?.lastTenantName) {
    contextSummaryLines.push(
      `Letzter Mieter-Kontext: ${contexts.tenant.lastTenantName}`
    );
  }

  // Property-Kontext (aktuelles Objekt) – als JSON ist hier okay,
  // weil das meist nur ein Label + ggf. Adresse ist
  if (contexts?.property) {
    contextSummaryLines.push(
      `Aktueller Objekt-Kontext: ${JSON.stringify(contexts.property)}`
    );
  }

  // Stadt-/Mietrechts-Kontext schön formatiert
  if (contexts?.city) {
    const c = contexts.city;
    const parts: string[] = [];

    if (c.lastCity) {
      const ort =
        c.lastPostal && c.lastPostal.trim()
          ? `${c.lastCity} (${c.lastPostal})`
          : c.lastCity;
      parts.push(ort);
    }

    if (typeof c.hasMietspiegel === "boolean") {
      parts.push(
        c.hasMietspiegel ? "Mietspiegel vorhanden" : "kein Mietspiegel hinterlegt"
      );
    }

    if (c.mietspiegelSource) {
      parts.push(`Quelle: ${c.mietspiegelSource}`);
    }

    if (parts.length > 0) {
      contextSummaryLines.push(
        `Aktueller Stadt-/Mietrechts-Kontext: ${parts.join(" | ")}`
      );
    } else {
      contextSummaryLines.push(
        "Aktueller Stadt-/Mietrechts-Kontext: (gesetzt, aber ohne detaillierte Angaben)"
      );
    }
  }

// User-Profil-Kontext (Risiko-/Stil-Infos über den Nutzer)
  if (contexts?.userProfile) {
    const p: any = contexts.userProfile;
    const parts: string[] = [];

    if (typeof p.fullName === "string" && p.fullName.trim()) {
      parts.push(`Name: ${p.fullName.trim()}`);
    }
    if (typeof p.primaryCity === "string" && p.primaryCity.trim()) {
      parts.push(`Stadt: ${p.primaryCity.trim()}`);
    }
    if (
      typeof p.investmentStyle === "string" &&
      p.investmentStyle.trim()
    ) {
      parts.push(`Anlagestil: ${p.investmentStyle}`);
    }
    if (
      typeof p.riskTolerance === "string" &&
      p.riskTolerance.trim()
    ) {
      parts.push(`Risikotoleranz: ${p.riskTolerance}`);
    }
    if (typeof p.notes === "string" && p.notes.trim()) {
      parts.push(
        `Notizen: ${p.notes.trim().slice(0, 120)}`
      );
    }

    if (parts.length > 0) {
      contextSummaryLines.push(`Nutzerprofil: ${parts.join(" | ")}`);
    }
  }

  // Generischer Fokus-Kontext (frei interpretierbar durch das Modell)
  if (contexts?.focus) {
    const f: any = contexts.focus;
    const parts: string[] = [];

    if (typeof f.label === "string" && f.label.trim()) {
      parts.push(`Label: ${f.label.trim()}`);
    }
    if (typeof f.kind === "string" && f.kind.trim()) {
      parts.push(`Typ: ${f.kind.trim()}`);
    }
    if (
      typeof f.referenceId === "string" &&
      f.referenceId.trim()
    ) {
      parts.push(`Ref: ${f.referenceId.trim()}`);
    }

    if (parts.length > 0) {
      contextSummaryLines.push(
        `Aktueller Fokus-Kontext: ${parts.join(" | ")}`
      );
    }
  }

  const contextSummary =
    contextSummaryLines.length > 0
      ? contextSummaryLines.join("\n")
      : "Es ist aktuell kein spezieller Kontext gesetzt (kein letzter Mieter, kein aktives Objekt, keine aktive Stadt).";


      const coreInterventionLine =
    core?.intervention
      ? `Core-Intervention (intern): level=${core.intervention.level}; reasons=${core.intervention.reasonCodes.join(",")}`
      : "Core-Intervention (intern): none";


  const userPrompt = `
Nutzer-ID: ${userId}
${namePart}

${coreInterventionLine}

# Bisherige Unterhaltung:
${lastTurns}

# Aktuelle Kontexte:
${contextSummary}

# Bereits gespeichertes Wissen:
${knowledgeSummary}

# Neue Nachricht:
"${truncatedMessage}"

Bitte gib NUR ein JSON im beschriebenen Format zurück.
`;

  try {

    logger.info("openai_call_runServerBrain", {
  userId,
  promptVersion: SYSTEM_PROMPT_DE_VERSION,
  model: "gpt-4o-mini",
});
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT_DE },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    logger.info("runServerBrain_raw_model_output", {
  userId,
  rawPreview: String(raw).slice(0, 1200),
  rawLength: String(raw).length,
});

    const parsed = safeParseAssistantJson(raw);

    logger.info("runServerBrain_parsed_preview", {
  userId,
  hasParsed: !!parsed,
  parsedKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
  newFactsRawCount: Array.isArray((parsed as any)?.newFacts) ? (parsed as any).newFacts.length : 0,
  newFactsRawPreview: Array.isArray((parsed as any)?.newFacts)
    ? JSON.stringify((parsed as any).newFacts.slice(0, 2)).slice(0, 1200)
    : null,
});

    if (!parsed || typeof parsed !== "object") {
      logger.error("Fehler: KI-Output war kein gültiges JSON-Objekt", { raw });
      return {
        reply: FALLBACK_COPY_DE.invalidJson,
        newFacts: [],
        actions: [],
        tasks: [],
      };
    }

    // 👉 Facts strikt validieren (zentral)
const newFacts = validateIngestFacts(
  userId,
  Array.isArray(parsed.newFacts) ? parsed.newFacts : [],
  { filename: null, source: null },
  { maxFacts: 50 }
);

logger.info("runServerBrain_newFacts_validated", {
  userId,
  validatedCount: newFacts.length,
  validatedPreview: JSON.stringify(newFacts.slice(0, 2)).slice(0, 1200),
});

// Fallback: wenn User klar "merke dir" sagt, aber Modell keine Facts liefert
const msgLower = String(message || "").toLowerCase();
const wantsRemember =
  msgLower.includes("merke dir") ||
  msgLower.includes("merk dir") ||
  msgLower.includes("speichere") ||
  msgLower.includes("notiere") ||
  msgLower.includes("bitte merken");

if (wantsRemember && newFacts.length === 0) {
  logger.warn("runServerBrain_forced_fact_fallback", { userId });

  newFacts.push({
    type: "generic",
    tags: ["source:chat", "intent:remember"],
    data: {},
    raw: String(message).slice(0, 2000),
  });
}

    // 👉 Actions strikt validieren (nur reset_context / set_context + begrenzt)
    const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const MAX_ACTIONS = 8;

    const actions: BrainAction[] = rawActions
      .slice(0, MAX_ACTIONS)
      .map((a: any): BrainAction | null => {
        if (!a || typeof a !== "object") return null;

        // reset_context
        if (
          a.type === "reset_context" &&
          (a.context === "tenant" ||
            a.context === "property" ||
            a.context === "city")
        ) {
          return {
            type: "reset_context",
            context: a.context,
            reason: typeof a.reason === "string" ? a.reason : undefined,
          };
        }

        // set_context
        if (
          a.type === "set_context" &&
          (a.context === "tenant" ||
            a.context === "property" ||
            a.context === "city")
        ) {
          let safeValue: Record<string, any> | undefined = undefined;

          if (a.value && typeof a.value === "object") {
            try {
              const json = JSON.stringify(a.value);
              if (json.length <= 4000) {
                safeValue = a.value as Record<string, any>;
              }
            } catch {
              safeValue = undefined;
            }
          }

          if (!safeValue) return null;

          return {
            type: "set_context",
            context: a.context,
            value: safeValue,
            reason: typeof a.reason === "string" ? a.reason : undefined,
          };
        }

        // alles andere verwerfen
        return null;
      })
      .filter((a: BrainAction | null): a is BrainAction => a !== null);

    const discardedActions = rawActions.length - actions.length;
    if (discardedActions > 0) {
      logger.warn("anora_actions_discarded", {
        total: rawActions.length,
        used: actions.length,
        discarded: discardedActions,
      });
    }

    // 👉 Tasks strikt validieren (Whitelist + Begrenzung + Payload-Schutz)
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const MAX_TASKS = 8;

    const tasks: BrainTask[] = rawTasks
      .slice(0, MAX_TASKS) // nicht unendlich viele Tasks zulassen
      .map((t: any): BrainTask | null => {
        if (!t || typeof t !== "object") return null;
        if (typeof t.type !== "string") return null;

        // Nur definierte Task-Typen erlauben
        if (
          t.type !== "clarify_context" &&
          t.type !== "manual_risk_check" &&
          t.type !== "watch_location" &&
          t.type !== "todo"
        ) {
          // Logging für verworfene Task-Typen
          logger.warn("runServerBrain_task_verworfen_unbekannter_typ", {
            userId,
            taskType: t.type,
          });
          return null;
        }

        let safePayload: BrainTask["payload"] | undefined = undefined;

        if (t.payload && typeof t.payload === "object") {
          try {
            const json = JSON.stringify(t.payload);
            // einfache Größenbegrenzung, damit kein Megapayload durchrutscht
            if (json.length <= 4000) {
              safePayload = t.payload;
            } else {
              logger.warn("runServerBrain_task_payload_zu_gross", {
                userId,
                length: json.length,
                type: t.type,
              });
            }
          } catch (err) {
            // Wenn JSON.stringify kracht → Payload ignorieren und loggen
            logger.warn("runServerBrain_task_payload_parse_error", {
              userId,
              type: t.type,
              error: String(err),
            });
            safePayload = undefined;
          }
        }

        return {
          type: t.type as BrainTask["type"],
          payload: safePayload,
        };
      })
      .filter((t: BrainTask | null): t is BrainTask => t !== null);

    // Kurzes Monitoring-Log für den finalen, rohen KI-Output (vor dem Safety-Layer in anoraChat)
    logger.info("runServerBrain_output_validated", {
      userId,
      replyLength:
        typeof parsed.reply === "string" ? parsed.reply.length : 0,
      newFactsCount: newFacts.length,
      actionsCount: actions.length,
      tasksCount: tasks.length,
    });

    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      newFacts,
      actions,
      tasks,
    };
  } catch (error) {
    logger.error("Fehler beim KI-Aufruf in runServerBrain", {
      error: String(error),
    });
    return {
      reply: FALLBACK_COPY_DE.genericError,
      newFacts: [],
      actions: [],
      tasks: [],
    };
  }
}

// ------------------------------------------------------------
// Spezielle Auswertung: Fragen nach Mieten / Mieterhöhungen
// für einen konkreten Mieter – nur aktueller Satz + letzte
// User-Nachricht als Kontext.
// ------------------------------------------------------------
// ------------------------------------------------------------
// Spezielle Auswertung: Fragen nach Mieten / Mieterhöhungen
// für einen konkreten Mieter – nur aktueller Satz + letzte
// User-Nachricht als Kontext.
// ------------------------------------------------------------


async function answerRentQuestionIfPossibleV2(input: BrainInput): Promise<BrainOutput | null> {
  const msg = String(input.message || "").toLowerCase();

  // nur Kaltmiete-Fragen (MVP)
  const asksColdRent =
    msg.includes("kaltmiete") ||
    msg.includes("cold rent") ||
    msg.includes("nettomiete");

  if (!asksColdRent) return null;



  // 1) entityId bestimmen: erst Context, sonst Fallback aus Core
  let entityId: string | null = null;



  const p: any = input.contexts?.property ?? null;
  if (p && typeof p.coreEntityId === "string" && p.coreEntityId.trim()) {
    entityId = p.coreEntityId.trim();
  }

  // DEBUG / MVP: Wenn es genau ein Property-Entity im Core gibt → automatisch nutzen
if (!entityId) {
  const all = await queryFacts(input.userId, {
    domain: "real_estate",
    key: "city",
    limit: 10,
  });

  const entityIds = Array.from(
    new Set(all.map((x) => x.data?.entityId).filter(Boolean))
  );

  if (entityIds.length === 1) {
    entityId = String(entityIds[0]);
  }
}

  if (!entityId) {
    const one = await getSingleLatestPropertySummaryFromCore(input.userId);
    if (one && one.entityId) entityId = String(one.entityId);
  }

  if (!entityId) {
    // kein Objektkontext -> nachfragen
    return {
      reply: "Welches Objekt genau? Bitte nenne Adresse oder eine Bezeichnung.",
      newFacts: [],
      actions: [],
      tasks: [{ type: "clarify_context", payload: { summary: "Welche Adresse oder Objekt-Bezeichnung?" } }],
    };
  }

  // 2) Facts holen
  const rentItems = await queryFacts(input.userId, {
    entityId,
    domain: "real_estate",
    key: "rent_cold",
    limit: 20,
  });

  const rows = rentItems
  .map((x) => x.data as any)
  .filter((d) => typeof d?.value === "number")
  .map((d) => ({
    value: d.value as number,
    sourceRef: typeof d.sourceRef === "string" ? d.sourceRef : null,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : null,
    factId: typeof d.factId === "string" ? d.factId : null,
  }));

// distinct Werte
const distinct = Array.from(new Set(rows.map((r) => r.value)));

// helper: Evidence-String für einen Wert
const evidenceForValue = (v: number) => {
  const matches = rows
    .filter((r) => r.value === v)
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));

  // wir zeigen maximal 3 Belege, sonst wird’s Spam
  const refs = matches
    .map((m) => m.sourceRef)
    .filter(Boolean)
    .slice(0, 3);

  if (refs.length === 0) return "";
  return ` (Beleg: ${refs.join(", ")})`;
};

if (distinct.length === 0) {
  return {
    reply: "Ich habe für dieses Objekt noch keine Kaltmiete gespeichert.",
    newFacts: [],
    actions: [],
    tasks: [{ type: "clarify_context", payload: { summary: "Kaltmiete fehlt – bitte nennen oder Dokument ingestieren." } }],
  };
}

if (distinct.length === 1) {
  const v = distinct[0];
  return {
    reply: `Die Kaltmiete beträgt ${v} EUR.${evidenceForValue(v)}`,
    newFacts: [],
    actions: [],
    tasks: [],
  };
}

// Konfliktfall: mehrere Werte → wir zeigen Werte + Evidence
const sorted = distinct.slice().sort((a, b) => b - a);
const lines = sorted.map((v) => `- ${v} EUR${evidenceForValue(v)}`).join("\n");

return {
  reply:
    `Ich habe mehrere Kaltmieten für dieses Objekt gespeichert.\n` +
    `${lines}\n\nWelche ist aktuell gültig?`,
  newFacts: [],
  actions: [],
  tasks: [{ type: "clarify_context", payload: { summary: "Welche Kaltmiete ist die aktuelle?" } }],
};
}

// ------------------------------------------------------------
// HTTPS Endpoint / anoraChat
// ------------------------------------------------------------
export const anoraChat = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    const body = req.body as {
      userId?: string;
      userName?: string | null;
      message?: string;
      history?: BrainChatMessage[];
    };

    // 🔐 Eingangs-Härtung: userId & message
    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    // userId validieren (Typ, Länge, erlaubte Zeichen)
    if (typeof body.userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const userId = body.userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

    if (!userIdPattern.test(userId)) {
      logger.warn("Invalid userId pattern", { rawUserId: body.userId });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // Hinweis: In der finalen Version sollte userId aus einer
    // vertrauenswürdigen Auth-Quelle (z.B. Firebase Auth UID) stammen
    // und NICHT nur aus dem Body übernommen werden.

    // message basic check
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      res.status(400).json({ error: "Missing or invalid message" });
      return;
    }

    const knowledge = await loadKnowledge(userId);
    const contexts: BrainContexts = (await loadBrainContexts(userId)) || {};

const safeUserName: string | null =
  typeof body.userName === "string" ? body.userName : null;

    const input: BrainInput = {
      userId,
      userName: safeUserName,
      message: body.message,
      history: Array.isArray(body.history) ? body.history : [],
      knowledge,
      contexts,
    };

    // ------------------------------------------------------------
// PHASE 3.1: Core-Haltung laden (intern, numerisch)
// ------------------------------------------------------------
const haltung = await getOrCreateCoreHaltungV1(userId);

// ------------------------------------------------------------
// PHASE 3.2: deterministische Trigger aus aktueller Nachricht
// (noch keine Wirkung – nur Observability)
// ------------------------------------------------------------
const triggerRes = computeHaltungTriggersFromMessage({
  message: input.message,
});

logger.info("core_haltung_triggers_v1", {
  userId,
  hasTrigger: triggerRes.hasTrigger,
  triggers: triggerRes.triggers,
});


// ------------------------------------------------------------
// PHASE 4.1: deterministische Intervention ableiten (Core)
// (noch keine Wirkung – nur Observability)
// ------------------------------------------------------------
const intervention = computeCoreInterventionV1({
  message: input.message,
  haltung,
  triggerRes,
});

logger.info("core_intervention_v1", {
  userId,
  level: intervention.level,
  reasonCodes: intervention.reasonCodes,
  debug: intervention.debug,
});

// ------------------------------------------------------------
// PHASE 3.3: Lernlogik (NUR explizites Feedback, sonst NO-OP)
// ------------------------------------------------------------
try {
  const learn = await applyHaltungLearningIfAny({
    userId,
    message: input.message,
  });

  if (learn.applied) {
    logger.info("core_haltung_learning_applied_v1", {
      userId,
      reason: learn.reason,
      patch: learn.patch,
    });
  } else {
    logger.info("core_haltung_learning_noop_v1", {
      userId,
    });
  }
} catch (err) {
  // Lernlogik darf Core nicht killen
  logger.warn("core_haltung_learning_failed_v1", {
    userId,
    error: String(err),
  });
}

// ------------------------------------------------------------
// PHASE 3.3: Lernlogik (nur explizites Feedback, deterministisch)
// ------------------------------------------------------------
const learningEvent = detectHaltungLearningEventFromMessage(input.message);

if (learningEvent) {
  const patch = deriveHaltungPatchFromEvent(haltung, learningEvent);

  // Patch nur anwenden, wenn wirklich etwas geändert würde
  if (Object.keys(patch).length > 0) {
    const next = await patchCoreHaltungV1(userId, patch);

    logger.info("core_haltung_learn_applied_v1", {
      userId,
      event: learningEvent.type,
      patch,
      before: {
        directness: haltung.directness,
        interventionDepth: haltung.interventionDepth,
        patience: haltung.patience,
        escalationThreshold: haltung.escalationThreshold,
        reflectionLevel: haltung.reflectionLevel,
      },
      after: {
        directness: next.directness,
        interventionDepth: next.interventionDepth,
        patience: next.patience,
        escalationThreshold: next.escalationThreshold,
        reflectionLevel: next.reflectionLevel,
      },
    });
  }
} else {
  logger.info("core_haltung_learn_none_v1", {
    userId,
    msgPreview: String(input.message || "").slice(0, 120),
  });
}

   // 1) Spezialfall: Fragen nach konkreten Mietbeträgen / -erhöhungen
const rentAnswer = await answerRentQuestionIfPossibleV2(input);
if (rentAnswer) {
  const safeRentAnswer = sanitizeBrainOutput(rentAnswer);
  res.status(200).json(safeRentAnswer);
  return;
}

    // 2) Standard-KI-Flow
    logger.info("anoraChat_request", {
      userId: input.userId,
      message: input.message,
      knowledgeCount: input.knowledge.length,
    });


    logger.info("DEBUG_contexts_before_prompt", {
  userId,
  propertyContext: contexts.property,
  knowledgeCount: knowledge.length,
  firstKnowledge: knowledge[0] ?? null,
});

  
    const result = await runLlmBrainSatellite(
  {
    openai,
    model: "gpt-4o-mini",
    systemPrompt: SYSTEM_PROMPT_DE,
    systemPromptVersion: SYSTEM_PROMPT_DE_VERSION,
    maxFactsPerPrompt: MAX_FACTS_PER_PROMPT,
    maxKnowledgeSummaryLength: MAX_KNOWLEDGE_SUMMARY_LENGTH,
    maxHistoryTurns: MAX_HISTORY_TURNS,
    maxHistorySummaryLength: MAX_HISTORY_SUMMARY_LENGTH,
    maxUserMessageLength: MAX_USER_MESSAGE_LENGTH,
    safeParseAssistantJson,
    validateIngestFacts,
    fallbackCopy: FALLBACK_COPY_DE,
  },
  input,
  {
    intervention: {
      level: intervention.level,
      reasonCodes: intervention.reasonCodes,
    },
  }
);

    // Safety-Layer anwenden (Antwortlänge, Arrays absichern, etc.)
    const safeResult = sanitizeBrainOutput(result);

    // ------------------------------------------------------------
// PHASE 4.2.3: Guard anwenden – Core-Grenzen erzwingen
// ------------------------------------------------------------
const guard = enforceCoreResponseBoundaries(safeResult.reply);

if (!guard.ok) {
  logger.warn("core_guard_violation", {
    userId: input.userId,
    violations: guard.violations,
  });

  // Harte Grenze: neutrale, sichere Antwort.
  // Keine Actions/Tasks/NewFacts – nichts Autonomes ausführen.
  safeResult.reply =
    "Ich kann dabei nicht helfen, etwas Eskalierendes/Manipulatives zu formulieren. " +
    "Sag mir stattdessen kurz das Ziel (z.B. sachlich klären, rechtlich prüfen, nächsten Schritt planen), " +
    "dann formuliere ich es neutral und sauber.";

  safeResult.actions = [];
  safeResult.tasks = [];
  safeResult.newFacts = [];
} else {
  logger.info("core_guard_ok", { userId: input.userId });
}

    // 👉 WICHTIG:
    // - Nur "actions" werden serverseitig interpretiert (z.B. reset_context / set_context).
    // - "tasks" sind ausschließlich Hinweise für die UI / den Nutzer.
    // - Der Server löst KEINE Cronjobs, Push-Tasks oder sonstige Aktionen aus Tasks aus.
    //
    // Damit bleibt Anora explizit nicht-autonom: sie schlägt nur vor, der Mensch entscheidet und handelt.

    if (safeResult.actions.length > 0) {
  await executeBrainActions(input.userId, safeResult.actions);
}

if (safeResult.newFacts.length > 0) {
  // Legacy-BrainFacts werden NICHT mehr persistiert.
  // newFacts dienen nur noch als transienter Kontext.
  await updatePropertyContextFromNewFacts(input.userId, safeResult.newFacts);
  await updateMietrechtContextFromFacts(input.userId, safeResult.newFacts);
}

try {
  // Minimal: persistiere ALLE Chat-Facts 1:1 als "chat.memory" in facts_v1
  // (später können wir property/tenant sauber mappen)
  const toUpsert = safeResult.newFacts.map((f, idx) => ({
    domain: "chat",
    key: "memory",
    entityId: `user:${input.userId}`, // simpel, stabil
    value: {
      type: f.type,
      tags: Array.isArray(f.tags) ? f.tags : [],
      data: f.data ?? {},
      raw: f.raw ?? "",
      seq: idx,
    },
    meta: {
      source: "chat",
      ts: Date.now(),
    },
  }));

  const r = await upsertManyFacts(input.userId, toUpsert as any);

  logger.info("chat_memory_upserted_v1", {
    userId: input.userId,
    count: toUpsert.length,
    result: r,
  });
} catch (err) {
  logger.error("chat_memory_upsert_failed_v1", {
    userId: input.userId,
    error: String(err),
  });
}

    // Presence-Logik v1: Kandidaten aus Chat + Tasks prüfen
    // - passiv, keine Autohandlungen
    // - strikt rate-limitiert
    try {
      await generatePresenceFromChatIfAllowed(input.userId, input, safeResult);
    } catch (err) {
      logger.error("presence_generation_failed", {
        userId: input.userId,
        error: String(err),
      });
    }

    const response: BrainOutput = safeResult;

    res.status(200).json(response);

  } catch (err) {
    logger.error("Fehler in anoraChat:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ------------------------------------------------------------
// Presence: letzte sichtbare Presence-Karte laden
// (statt nur status == "pending")
// ------------------------------------------------------------
async function getLatestVisiblePresenceEvent(
  userId: string
): Promise<{ id: string; data: PresenceEventDoc } | null> {
  const col = db
    .collection("brain")
    .doc(userId)
    .collection("presenceEvents");

  const now = Date.now();

  // NEU: Themen-Block-Meta laden
  const topicMeta = await getPresenceTopicMeta(userId);

  // Wir holen die letzten ~50 Events nach Zeit, filtern dann im Code
  const snap = await col
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  if (snap.empty) return null;

  for (const doc of snap.docs) {
    const data = doc.data() as PresenceEventDoc;

    // 0) Themen-Block prüfen (Topic global geblockt?)
    if (data.topic) {
      const t = data.topic as PresenceTopic;
      const state = topicMeta[t];
      if (
        state &&
        typeof state.blockedUntil === "number" &&
        state.blockedUntil > now
      ) {
        // dieses Thema ist gerade global geblockt -> nicht anzeigen
        continue;
      }
    }

    // 1) Themen, die explizit abgeschaltet wurden, NIE mehr anzeigen
    if (data.status === "dismissed") {
      continue;
    }

    // 2) Snoozed-Events nur anzeigen, wenn ihre Snooze-Zeit abgelaufen ist
    if (
      data.status === "snoozed" &&
      typeof data.snoozedUntil === "number" &&
      data.snoozedUntil > now
    ) {
      continue;
    }

    // 3) Alles andere (pending, shown, alte snoozed) ist sichtbar
    return { id: doc.id, data };
  }

  // nichts Sichtbares gefunden
  return null;
}

// ------------------------------------------------------------
// HTTPS Endpoint: Anora Presence – nächste Presence-Karte laden
// ------------------------------------------------------------
export const anoraPresence = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const { userId } = body;

    // userId validieren – gleiche Logik wie bei anoraChat
    if (typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("anoraPresence_invalid_userId_pattern", {
        rawUserId: userId,
      });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // Presence-Opt-out respektieren
    const enabled = await isPresenceEnabledForUser(trimmedUserId);
    if (!enabled) {
      logger.info("anoraPresence_opt_out_active", { userId: trimmedUserId });
      res.status(200).json({
        ok: true,
        event: null,
      });
      return;
    }

    // Neu: letzte sichtbare Presence holen
    const next = await getLatestVisiblePresenceEvent(trimmedUserId);
    if (!next) {
      // Kein Event -> einfach ok + null zurückgeben
      res.status(200).json({
        ok: true,
        event: null,
      });
      return;
    }

    logger.info("anoraPresence_next_event", {
      userId: trimmedUserId,
      eventId: next.id,
      type: next.data.type,
      status: next.data.status,
    });

    res.status(200).json({
      id: next.id,
      event: next.data,
    });
  } catch (err) {
    logger.error("anoraPresence_error", { error: String(err) });
    res
      .status(500)
      .json({ error: "Internal server error in anoraPresence" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: Anora Presence Action – Button-Aktion speichern
// ------------------------------------------------------------
export const anoraPresenceAction = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const { userId, eventId, action } = body;

    // userId validieren – gleiche Logik wie bei anoraChat
    if (typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }
    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("anoraPresenceAction_invalid_userId_pattern", {
        rawUserId: userId,
      });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // eventId prüfen
    if (typeof eventId !== "string" || !eventId.trim()) {
      res.status(400).json({ error: "Missing or invalid eventId" });
      return;
    }

    // action prüfen
    if (
      action !== "view_now" &&
      action !== "snooze" &&
      action !== "disable"
    ) {
      res.status(400).json({ error: "Invalid action" });
      return;
    }

   const now = Date.now();

    // 1) Falls "disable": Event laden und Thema bestimmen
    let topicToBlock: PresenceTopic | null = null;

    if (action === "disable") {
      try {
        const eventSnap = await db
          .collection("brain")
          .doc(trimmedUserId)
          .collection("presenceEvents")
          .doc(eventId.trim())
          .get();

        if (eventSnap.exists) {
          const data = eventSnap.data() as PresenceEventDoc;

          if (data.topic) {
  topicToBlock = data.topic;
}
        }
      } catch (err) {
        logger.error("anoraPresenceAction_load_event_failed", {
          userId: trimmedUserId,
          eventId,
          error: String(err),
        });
      }
    }

    // 2) Status-Update vorbereiten
    let updates: {
      status?: PresenceEventStatus;
      shownAt?: number | null;
      dismissedAt?: number | null;
      snoozedUntil?: number | null;
    } = {};

    if (action === "view_now") {
      updates = {
        status: "shown",
        shownAt: now,
      };
    } else if (action === "snooze") {
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      updates = {
        status: "snoozed",
        snoozedUntil: now + THREE_HOURS,
      };
    } else if (action === "disable") {
      updates = {
        status: "dismissed",
        dismissedAt: now,
      };
    }

    // 2) Event-Status in Firestore schreiben
    await updatePresenceEventStatus(
      trimmedUserId,
      eventId.trim(),
      updates
    );

    // 3) Falls "disable": Themen für 90 Tage muten
    // 3) Falls "disable": Thema für 90 Tage blocken (presenceTopics-Meta)
    if (action === "disable" && topicToBlock) {
      const BLOCK_DURATION_DAYS = 90;
      const BLOCK_DURATION_MS = BLOCK_DURATION_DAYS * 24 * 60 * 60 * 1000;
      const blockedUntil = now + BLOCK_DURATION_MS;

      try {
        await updatePresenceTopicMeta(
          trimmedUserId,
          topicToBlock,
          blockedUntil,
          now
        );

        logger.info("anoraPresenceAction_topic_block_set", {
          userId: trimmedUserId,
          eventId,
          topic: topicToBlock,
          blockedUntil,
        });
      } catch (err) {
        logger.error("anoraPresenceAction_topic_block_failed", {
          userId: trimmedUserId,
          eventId,
          topic: topicToBlock,
          error: String(err),
        });
      }
    }

    logger.info("anoraPresenceAction_ok", {
      userId: trimmedUserId,
      eventId,
      action,
    });

    res.status(200).json({
      ok: true,
    });

  } catch (err) {
    logger.error("anoraPresenceAction_error", { error: String(err) });
    res
      .status(500)
      .json({ error: "Internal server error in anoraPresenceAction" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: Anora Presence Settings – Presence ein/aus
// ------------------------------------------------------------
export const anoraPresenceSettings = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const { userId, enabled } = body;

    // userId validieren – gleiche Logik wie bei anoraChat
    if (typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("anoraPresenceSettings_invalid_userId_pattern", {
        rawUserId: userId,
      });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // enabled prüfen
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "Missing or invalid enabled flag" });
      return;
    }

    // Presence-Flag setzen
    await setPresenceEnabledForUser(trimmedUserId, enabled);

    logger.info("anoraPresenceSettings_ok", {
      userId: trimmedUserId,
      enabled,
    });

    res.status(200).json({
      ok: true,
      enabled, // <- das kommt aus dem Request-Body
    });
  } catch (err) {
    logger.error("anoraPresenceSettings_error", { error: String(err) });
    res
      .status(500)
      .json({ error: "Internal server error in anoraPresenceSettings" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: Presence Topics – Themen muten / anzeigen
// ------------------------------------------------------------
export const anoraPresenceTopics = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const { userId, topic, muted } = body;

    // userId validieren – gleiche Logik wie bei anoraChat
    if (typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("anoraPresenceTopics_invalid_userId_pattern", {
        rawUserId: userId,
      });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // Wenn KEIN topic übergeben wird -> nur aktuelle Topic-States zurückgeben
    if (typeof topic !== "string") {
      const topicMeta = await getPresenceTopicMeta(trimmedUserId);

      logger.info("anoraPresenceTopics_read_only", {
        userId: trimmedUserId,
      });

      res.status(200).json({
        ok: true,
        userId: trimmedUserId,
        topics: topicMeta,
      });
      return;
    }

    // Ab hier: konkretes Topic muten / entmuten
    // Wir erlauben nur die Themen, die wir real nutzen
    const allowedTopics: PresenceTopic[] = [
      "stress_cluster",
      "money_decision",
      "project_followup",
      "location_watch",
      "other",
    ];

    if (!allowedTopics.includes(topic as PresenceTopic)) {
      res.status(400).json({ error: "Invalid topic" });
      return;
    }

    if (typeof muted !== "boolean") {
      res.status(400).json({ error: "Missing or invalid muted flag" });
      return;
    }

    const now = Date.now();

    // Wenn muted=true -> 90 Tage blocken
    // Wenn muted=false -> Block aufheben (blockedUntil in die Vergangenheit setzen)
    const BLOCK_DURATION_DAYS = 90;
    const BLOCK_DURATION_MS = BLOCK_DURATION_DAYS * 24 * 60 * 60 * 1000;

    const blockedUntil = muted ? now + BLOCK_DURATION_MS : 0;
    const lastDisabledAt = muted ? now : now; // wir protokollieren einfach jetzt

    await updatePresenceTopicMeta(
      trimmedUserId,
      topic as PresenceTopic,
      blockedUntil,
      lastDisabledAt
    );

    const topicMeta = await getPresenceTopicMeta(trimmedUserId);

    logger.info("anoraPresenceTopics_topic_updated", {
      userId: trimmedUserId,
      topic,
      muted,
      blockedUntil,
    });

    res.status(200).json({
      ok: true,
      userId: trimmedUserId,
      topics: topicMeta,
    });
  } catch (err) {
    logger.error("anoraPresenceTopics_error", { error: String(err) });
    res
      .status(500)
      .json({ error: "Internal server error in anoraPresenceTopics" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: komplettes Wissen eines Users löschen
// (Panic-Reset – NUR aus Einstellungen aufrufen!)
// ------------------------------------------------------------
export const resetUserKnowledge = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId } = body ?? {};
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    logger.info("resetUserKnowledge_request", { userId });

    await wipeUserKnowledge(userId);

    res.status(200).json({
      ok: true,
      message: "Wissen für diesen Nutzer wurde vollständig zurückgesetzt.",
    });
  } catch (err) {
    logger.error("resetUserKnowledge_error", err);
    res.status(500).json({ error: "Internal server error in resetUserKnowledge" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: Anoras Persönlichkeit für einen User zurücksetzen
// (heute nur meta/personality löschen – vorbereitet für v2)
// ------------------------------------------------------------
export const resetUserPersonality = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId } = body ?? {};
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    logger.info("resetUserPersonality_request", { userId });

    await resetUserPersonalityData(userId);

    res.status(200).json({
      ok: true,
      message: "Anoras Persönlichkeit für diesen Nutzer wurde zurückgesetzt.",
    });
  } catch (err) {
    logger.error("resetUserPersonality_error", err);
    res
      .status(500)
      .json({ error: "Internal server error in resetUserPersonality" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: Anora User Profile – lesen / aktualisieren
// ------------------------------------------------------------
export const anoraUserProfile = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const { userId, profile } = body;

    // userId validieren – gleiche Logik wie bei anoraChat
    if (typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("anoraUserProfile_invalid_userId_pattern", {
        rawUserId: userId,
      });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // Wenn kein profile-Objekt mitkommt → nur lesen
    if (!profile || typeof profile !== "object") {
      const existing = await getUserMetaProfileForUser(trimmedUserId);
      res.status(200).json({
        ok: true,
        userId: trimmedUserId,
        profile: existing,
      });
      return;
    }

    // Schlanke Validierung der Felder
    const update: Partial<UserMetaProfile> = {};

    if (
      typeof profile.displayName === "string" &&
      profile.displayName.trim()
    ) {
      update.displayName = profile.displayName.trim().slice(0, 100);
    }

    if (typeof profile.role === "string" && profile.role.trim()) {
      update.role = profile.role.trim().slice(0, 100);
    }

    if (typeof profile.defaultCity === "string" && profile.defaultCity.trim()) {
      update.defaultCity = profile.defaultCity.trim().slice(0, 100);
    }

    if (
      typeof profile.defaultPostal === "string" &&
      profile.defaultPostal.trim()
    ) {
      update.defaultPostal = profile.defaultPostal.trim().slice(0, 20);
    }

    if (typeof profile.notes === "string" && profile.notes.trim()) {
      update.notes = profile.notes.trim().slice(0, 1000);
    }

    // Wenn nach der Bereinigung nichts übrig ist → einfach aktuelles Profil zurückgeben
    if (Object.keys(update).length === 0) {
      const existing = await getUserMetaProfileForUser(trimmedUserId);
      res.status(200).json({
        ok: true,
        userId: trimmedUserId,
        profile: existing,
      });
      return;
    }

    const merged = await setUserMetaProfileForUser(trimmedUserId, update);

    logger.info("anoraUserProfile_updated", {
      userId: trimmedUserId,
      updateKeys: Object.keys(update),
    });

    res.status(200).json({
      ok: true,
      userId: trimmedUserId,
      profile: merged,
    });
  } catch (err) {
    logger.error("anoraUserProfile_error", { error: String(err) });
    res
      .status(500)
      .json({ error: "Internal server error in anoraUserProfile" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: ingestRawDocumentText (Punkt 2 – bewusst ohne Facts)
// ------------------------------------------------------------
export const ingestRawDocumentText = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId, text, meta, locale } = body ?? {};

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }
    if (!text || typeof text !== "string" || text.trim().length < 20) {
      res.status(400).json({ error: "Missing or too short text" });
      return;
    }

    const safeMeta = {
      filename: meta?.filename ?? null,
      mimeType: meta?.mimeType ?? null,
      source: meta?.source ?? null,
    };

    const ts = Date.now();
    const bucket = dayBucketUTC(ts);

    // Dedup v0: stabiler Hash über (sourceType + text + bucket + meta-hints)
    const sourceType = "ingest_document_text";
    const hashInput =
      `${sourceType}\n${bucket}\n` +
      `filename:${safeMeta.filename ?? ""}\nsource:${safeMeta.source ?? ""}\n` +
      text;

    const ingestHash = sha256(hashInput);

    // Optional: Duplicate markieren (nicht löschen)
    // Wir suchen 1 Event mit gleichem ingestHash.
    // Wenn Firestore ohne Index meckert, lassen wir das im nächsten Schritt indexen.
    let isDuplicate = false;
    let duplicateOf: string | null = null;

    try {
      const snap = await admin
        .firestore()
        .collection("brain")
        .doc(userId)
        .collection("rawEvents")
        .where("ingestHash", "==", ingestHash)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();

      if (!snap.empty) {
        isDuplicate = true;
        duplicateOf = snap.docs[0].id;
      }
// PHASE 1: harte Dedupe-Regel
// Wenn identischer Ingest gefunden: KEIN neues RawEvent anlegen, bestehende ID zurückgeben.
if (duplicateOf) {
  logger.info("rawEvent_dedup_reuse", {
    userId,
    ingestHash,
    duplicateOf,
  });

  res.status(200).json({
    ok: true,
    rawEventId: duplicateOf,
    ingestHash,
    isDuplicate: true,
    duplicateOf,
    reused: true,
  });
  return;
}

    } catch (e) {
      // Dedup ist optional in v0. Wir loggen nur.
      logger.warn("rawEvent_dedup_check_failed", { userId, error: String(e) });
    }

    const doc: RawEventDoc = {
      timestamp: ts,
      sourceType,
      userRef: userId,
      locale: typeof locale === "string" ? locale : "de-DE",
      payload: { text },
      meta: safeMeta,
      ingestHash,
      dayBucket: bucket,
      isDuplicate,
      duplicateOf,
      note: null,
    };

    logger.info("rawEvent_append_request", {
      userId,
      sourceType,
      textLength: text.length,
      ingestHash,
      isDuplicate,
    });

    const rawEventId = await appendRawEvent(userId, doc);

    logger.info("rawEvent_append_success", {
      userId,
      rawEventId,
      ingestHash,
      isDuplicate,
      duplicateOf,
    });

    res.status(200).json({
      ok: true,
      rawEventId,
      ingestHash,
      isDuplicate,
      duplicateOf,
    });
  } catch (err) {
    logger.error("ingestRawDocumentText_error", { error: String(err) });
    res.status(500).json({ error: "Internal server error in ingestRawDocumentText" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: getRawEvent (Mini-Polish 2.5)
// ------------------------------------------------------------
export const getRawEvent = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId, rawEventId } = body ?? {};

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("getRawEvent_invalid_userId_pattern", { rawUserId: userId });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    if (!rawEventId || typeof rawEventId !== "string" || !rawEventId.trim()) {
      res.status(400).json({ error: "Missing or invalid rawEventId" });
      return;
    }

    const id = rawEventId.trim();

    const data = await getRawEventById(trimmedUserId, id);
    if (!data) {
      res.status(404).json({ ok: false, error: "RawEvent not found" });
      return;
    }

    res.status(200).json({
      ok: true,
      id,
      event: data,
    });
  } catch (err) {
    logger.error("getRawEvent_error", { error: String(err) });
    res.status(500).json({ error: "Internal server error in getRawEvent" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: listRawEvents (Mini-Polish 2.5)
// ------------------------------------------------------------
export const listRawEvents = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId, limit, from, to, sourceType } = body ?? {};

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("listRawEvents_invalid_userId_pattern", { rawUserId: userId });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // limit absichern
    let safeLimit = 50;
    if (typeof limit === "number" && Number.isFinite(limit)) {
      safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    }

    // from/to absichern
    let safeFrom: number | undefined = undefined;
    let safeTo: number | undefined = undefined;

    if (typeof from === "number" && Number.isFinite(from) && from > 0) {
      safeFrom = Math.floor(from);
    }
    if (typeof to === "number" && Number.isFinite(to) && to > 0) {
      safeTo = Math.floor(to);
    }

    // sourceType absichern (v0: nur ingest_document_text)
    let safeSourceType: "ingest_document_text" | undefined = undefined;
    if (typeof sourceType === "string" && sourceType === "ingest_document_text") {
      safeSourceType = "ingest_document_text";
    }

    const items = await listRawEventsFromStore({
  userId: trimmedUserId,
  limit: safeLimit,
  from: safeFrom,
  to: safeTo,
  sourceType: safeSourceType,
});

    res.status(200).json({
      ok: true,
      userId: trimmedUserId,
      count: items.length,
      items,
    });
  } catch (err) {
    logger.error("listRawEvents_error", { error: String(err) });
    res.status(500).json({ error: "Internal server error in listRawEvents" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: ingestDocumentText
// ------------------------------------------------------------
export const ingestDocumentText = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId, text, meta } = body ?? {};

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    if (!text || typeof text !== "string" || text.trim().length < 20) {
      res.status(400).json({
        error:
          "Missing or too short text – bitte den vollständigen Dokumenttext senden.",
      });
      return;
    }

    const cleanText =
      text.length > 15000 ? text.slice(0, 15000) + "\n\n[TEXT GEKÜRZT]" : text;

    const safeMeta = {
      filename: meta?.filename ?? null,
      mimeType: meta?.mimeType ?? null,
      source: meta?.source ?? null,
    };

    logger.info("ingestDocumentText_request", {
      userId,
      filename: safeMeta.filename,
      mimeType: safeMeta.mimeType,
      textLength: cleanText.length,
    });


    const { ingestRealEstateDocumentText } = await import("./domains/real_estate/index.js");

const result = await ingestRealEstateDocumentText(
  { userId, locale: "de-DE" },
  { text: cleanText, meta: safeMeta }
);

    logger.info("ingestDocumentText_success", {
      userId,
      factsSaved: result.factsSaved,
    });

    res.status(200).json({
      ok: true,
      factsSaved: result.factsSaved,
    });
    
  } catch (err) {
    logger.error("ingestDocumentText_error", err);
    res
      .status(500)
      .json({ error: "Internal server error in ingestDocumentText" });
  }
});// ------------------------------------------------------------
// HTTPS Endpoint: Anora User Profile – kompakte User-Sicht
// ------------------------------------------------------------
export const anoraUserOverview = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const { userId } = body;

    // userId validieren – gleiche Logik wie bei anoraChat
    if (typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("anoraUserProfile_invalid_userId_pattern", {
        rawUserId: userId,
      });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // Relevante Metadaten / Kontexte und Presence Settings parallel laden
    const [
      tenantMeta,
      propertyMeta,
      mietrechtContext,
      presenceSettings,
      presenceTopics,
    ] = await Promise.all([
      getMetaContext(trimmedUserId, "tenantContext"),
      getMetaContext(trimmedUserId, "propertyContext"),
      getMietrechtContextForUser(trimmedUserId),
      getPresenceSettingsForUser(trimmedUserId),
      getPresenceTopicMeta(trimmedUserId), // <- NEU
    ]);

    logger.info("anoraUserProfile_ok", {
      userId: trimmedUserId,
    });

    res.status(200).json({
      ok: true,
      userId: trimmedUserId,
      contexts: {
        tenant: tenantMeta ?? null,
        property: propertyMeta ?? null,
        mietrecht: mietrechtContext ?? null,
      },
      presence: {
        ...presenceSettings,
        topics: presenceTopics ?? {}, // <- NEU
      },
    });
  } catch (err) {
    logger.error("anoraUserProfile_error", { error: String(err) });
    res
      .status(500)
      .json({ error: "Internal server error in anoraUserProfile" });
  }
});

// ------------------------------------------------------------
// HTTPS Endpoint: Debug – Mietrechts-/City-Kontext für einen User
// ------------------------------------------------------------
export const debugMietrechtContext = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const { userId } = body;

    // userId validieren – gleiche Logik wie bei anoraChat
    if (typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const trimmedUserId = userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(trimmedUserId)) {
      logger.warn("debugMietrechtContext_invalid_userId_pattern", {
        rawUserId: userId,
      });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // "schöne" Mietrechts-Sicht (abgeleitet)
    const mietrechtContext = await getMietrechtContextForUser(trimmedUserId);

    // rohe Meta-Daten aus cityContext (falls du sehen willst, was genau drin steht)
    const rawCityMeta = await getMetaContext(trimmedUserId, "cityContext");

    res.status(200).json({
      ok: true,
      userId: trimmedUserId,
      mietrechtContext,
      rawCityMeta,
    });
  } catch (err) {
    logger.error("debugMietrechtContext_error", { error: String(err) });
    res
      .status(500)
      .json({ error: "Internal server error in debugMietrechtContext" });
  }
});

// ------------------------------------------------------------
// Test-Endpoint: Document-Strategie prüfen (Hybrid-Variante)
// ------------------------------------------------------------
export const testDocumentStrategy = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    const body = req.body || {};

    const input: DocumentInput = {
      mimeType: typeof body.mimeType === "string" ? body.mimeType : "",
      pages: typeof body.pages === "number" ? body.pages : 0,
      textChars: typeof body.textChars === "number" ? body.textChars : 0,
      isScanned: !!body.isScanned,
      hasTables: !!body.hasTables,
      quality:
        body.quality === "low" ||
        body.quality === "medium" ||
        body.quality === "high"
          ? body.quality
          : "medium",
    };

    const decision = decideDocumentProcessingStrategy(input);

    res.status(200).json({
      ok: true,
      input,
      decision,
    });
  } catch (err) {
    logger.error("Fehler in testDocumentStrategy:", err);
    res.status(500).json({ ok: false, error: "internal error" });
  }
});

export const resolveEntityV1 = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        res.status(400).json({ ok: false, error: "Invalid JSON body" });
        return;
      }
    }

    const userId = String(body?.userId ?? "").trim();
    const domain = body?.domain ?? "generic";
    const type = body?.type ?? "generic";
    const fingerprint = String(body?.fingerprint ?? "");

    const opts: any = { userId, domain, type, fingerprint };

if (typeof body?.label === "string" && body.label.trim()) {
  opts.label = body.label.trim();
}

if (body?.meta && typeof body.meta === "object") {
  opts.meta = body.meta;
}

const out = await getOrCreateEntityIdByFingerprint(opts);

    res.status(200).json({ ok: true, ...out });
  } catch (err) {
    logger.error("resolveEntityV1_error", { error: String(err) });
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ------------------------------------------------------------
// DEBUG Endpoint: upsertFactsV1 (Roadmap 3.3 Test)
// ------------------------------------------------------------
export const upsertFactsV1 = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId, facts } = body ?? {};
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }
    if (!Array.isArray(facts)) {
      res.status(400).json({ error: "Missing or invalid facts array" });
      return;
    }

    const result = await upsertManyFacts(userId.trim(), facts);

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("upsertFactsV1_error", { error: String(err) });
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ------------------------------------------------------------
// DEBUG Endpoint: extractFactsV1 (Roadmap 3.7 Test)
// ------------------------------------------------------------
export const extractFactsV1 = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId, extractorId, text, meta, locale } = body ?? {};

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const id = String(extractorId ?? "real_estate.v1").trim();
    const ex = getExtractor(id);
    if (!ex) {
      res.status(400).json({ error: `Unknown extractorId: ${id}` });
      return;
    }

    const payload = { text: typeof text === "string" ? text : "" };

    const result = await ex.extract({
      rawEventId: "debug",
      locale: typeof locale === "string" ? locale : "de-DE",
      sourceType: "debug_extract",
      payload,
      meta: meta && typeof meta === "object" ? meta : {},
    });

    res.status(200).json({
      ok: true,
      extractorId: id,
      factsCount: result.facts?.length ?? 0,
      warnings: result.warnings ?? [],
      // bewusst keine Facts im Detail zurück, weil später groß sein kann;
      // wenn du willst, schalten wir es im Debug frei.
    });
  } catch (err) {
    logger.error("extractFactsV1_error", { error: String(err) });
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ------------------------------------------------------------
// V1 Runner: RawEvent -> Extractor -> facts_v1
// Roadmap 3.8
// ------------------------------------------------------------
export const runExtractorOnRawEventV1 = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        res.status(400).json({ ok: false, error: "Invalid JSON body" });
        return;
      }
    }

    const userId = String(body?.userId ?? "").trim();
    const rawEventId = String(body?.rawEventId ?? "").trim();
    const extractorId = String(body?.extractorId ?? "real_estate.v1").trim();

    // userId validieren (gleiches Pattern wie bei anoraChat)
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(userId)) {
      res.status(400).json({ ok: false, error: "Invalid userId format" });
      return;
    }
    if (!rawEventId) {
      res.status(400).json({ ok: false, error: "Missing rawEventId" });
      return;
    }

    // 1) RawEvent laden
    const raw = await getRawEventById(userId, rawEventId);
    if (!raw) {
      res.status(404).json({ ok: false, error: "RawEvent not found" });
      return;
    }

// 2) Runner (ausgelagert)
const out = await runExtractorOnRawEventV1Core({
  userId,
  rawEventId,
  extractorId,
  raw,
});

res.status(200).json(out);
return;

  } catch (err) {
    logger.error("runExtractorOnRawEventV1_error", { error: String(err) });
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});


// ------------------------------------------------------------
// V1 Runner: RawEvent -> ALL Extractors -> facts_v1
// Roadmap 4.2
// ------------------------------------------------------------
export const runAllExtractorsOnRawEventV1 = onRequest(
  { timeoutSeconds: 180, memory: "1GiB" },
  async (req, res) => {
    try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        res.status(400).json({ ok: false, error: "Invalid JSON body" });
        return;
      }
    }

    const userId = String(body?.userId ?? "").trim();
    const rawEventId = String(body?.rawEventId ?? "").trim();
    const extractorIds = Array.isArray(body?.extractorIds) ? body.extractorIds.map((x: any) => String(x)) : undefined;

    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!userIdPattern.test(userId)) {
      res.status(400).json({ ok: false, error: "Invalid userId format" });
      return;
    }
    if (!rawEventId) {
      res.status(400).json({ ok: false, error: "Missing rawEventId" });
      return;
    }

    const raw = await getRawEventById(userId, rawEventId);
    if (!raw) {
      res.status(404).json({ ok: false, error: "RawEvent not found" });
      return;
    }

    const out = await runAllExtractorsOnRawEventV1Core({
      userId,
      rawEventId,
      raw,
      extractorIds,
    });

    res.status(200).json(out);
  } catch (err) {
    logger.error("runAllExtractorsOnRawEventV1_error", { error: String(err) });
    res.status(500).json({ ok: false, error: "Internal error" }
      
    );
  }
});


// ------------------------------------------------------------
// DEBUG Endpoint: listFactsV1 (Roadmap 3.3 Test)
// ------------------------------------------------------------
export const listFactsV1 = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const { userId, entityId, key, domain, limit } = body ?? {};
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const items = await queryFacts(userId.trim(), {
      entityId: typeof entityId === "string" ? entityId : undefined,
      key: typeof key === "string" ? key : undefined,
      domain: typeof domain === "string" ? domain : undefined,
      limit: typeof limit === "number" ? limit : 50,
    });

    res.status(200).json({
      ok: true,
      userId: userId.trim(),
      count: items.length,
      items,
    });
  } catch (err) {
    logger.error("listFactsV1_error", { error: String(err) });
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});