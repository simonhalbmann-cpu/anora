// functions/src/core/runCoreOnce.ts
/**
 * PHASE 6.1 – Pure Core Entry
 * - Pure: no Firestore, no writes, no side effects
 * - Deterministic: same input => same output
 *
 * Pipeline:
 * text -> rawEvent (in-memory) -> extractors -> validatedFacts
 * -> factsDiff (new/ignored) -> haltungDelta -> intervention
 */
import { FROZEN } from "./CORE_FREEZE";
import { toEntityDomain } from "./entities/types";
import { dayBucketUTC, sha256 } from "./rawEvents/hash";
import type { RawEventDoc } from "./rawEvents/types";

import { buildFactId } from "./facts/factId";
import { normalizeFactValueByLocale } from "./facts/locale";
import { normalizeFactKey } from "./facts/semantic";
import type { FactInput, ValidityWindow } from "./facts/types";

import { detectHaltungLearningEventFromMessage } from "./haltung/detect";
import { deriveHaltungPatchFromEvent } from "./haltung/learn";
import type { HaltungTriggerResult } from "./haltung/triggers";
import { computeHaltungTriggersFromMessage } from "./haltung/triggers";
import type { CoreHaltungV1 } from "./haltung/types";

import { computeCoreInterventionV1 } from "./interventions/controller";
import type { CoreInterventionV1 } from "./interventions/types";

import { getExtractor, listExtractors } from "./facts/registry";
import { toExtractorInputV1 } from "./runner/extractorInput";

import { mapIdFromFingerprint, normalizeFingerprint } from "./entities/fingerprint";
import { stableStringify } from "./utils/stableStringify";

import { getSatellite } from "./satellites/registry";
import type { SatelliteInput, SatelliteOutput } from "./satellites/satelliteContract";

// -----------------------
// Types
// -----------------------

type ConflictEventV1 = {
  entityId: string;
  key: string;
  userValue: any;
  docValue: any;
  userFactId?: string;
  docFactId?: string;
};

export type RunCoreOnceInput = {
  userId: string;
  text: string;

  state?: {
  locale?: string; // default: "de-DE"
  facts?: {
    factId: string;
    entityId: string;
    domain: string;
    key: string;
    value: any;
    validity?: { from?: number; to?: number };
    meta?: Record<string, any>;
  }[];
  haltung?: CoreHaltungV1;
  satelliteIds?: string[];

  // ✅ NEU
  tier?: "free" | "pro";
};

  // optional: allow limiting extractors; [] means "none"
  extractorIds?: string[];
};

export type RunCoreOnceOutput = {
  rawEvent: {
    rawEventId: string;
    doc: RawEventDoc;
  };

  validatedFacts: {
    factId: string;

    entityId: string;
    entityFingerprint?: string;
    entityDomain?: string;
    entityType?: string;

    domain: string;
    key: string;
    value: any;

    validity?: { from?: number; to?: number };
    meta?: Record<string, any>;

    source?: string;
    sourceRef?: string;
    conflict?: boolean;
  }[];

  conflicts?: ConflictEventV1[];

  factsDiff: {
  new: string[];
  updated: string[];  // ✅ NEU: existiert, aber Inhalt anders
  ignored: string[];
};

// Optional, aber extrem hilfreich fürs Debugging & spätere History:
factsChanges?: {
  factId: string;
  kind: "new" | "updated" | "ignored";
  key: string;
  entityId: string;
}[];

  haltungDelta: {
    before: CoreHaltungV1;
    after: CoreHaltungV1;
    patch: Partial<Omit<CoreHaltungV1, "version" | "updatedAt">>;
    learningEvent: null | { type: string; strength?: number };
    triggers: HaltungTriggerResult;
  };

  intervention: CoreInterventionV1;

  effects: {
    writesPlanned: false;
  };

  debug?: Record<string, any>;
};

// -----------------------
// Helpers (pure)
// -----------------------

function deterministicDefaultHaltungV1(): CoreHaltungV1 {
  // Same defaults as defaultCoreHaltungV1(), but with updatedAt=0 for determinism.
  return {
    version: 1,
    directness: 0.5,
    interventionDepth: 0.5,
    patience: 0.5,
    escalationThreshold: 0.7,
    reflectionLevel: 0.5,
    updatedAt: 0,
  };
}

function clamp01(n: any, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

function normalizeHaltungPure(h: any): CoreHaltungV1 {
  const base = deterministicDefaultHaltungV1();
  if (!h || typeof h !== "object") return base;

  return {
    version: 1,
    directness: clamp01(h.directness, base.directness),
    interventionDepth: clamp01(h.interventionDepth, base.interventionDepth),
    patience: clamp01(h.patience, base.patience),
    escalationThreshold: clamp01(h.escalationThreshold, base.escalationThreshold),
    reflectionLevel: clamp01(h.reflectionLevel, base.reflectionLevel),
    updatedAt: typeof h.updatedAt === "number" ? h.updatedAt : base.updatedAt,
  };
}

function validateFactInputV1Pure(f: any): { ok: boolean; reason?: string } {
  if (!f || typeof f !== "object") return { ok: false, reason: "not_object" };

  const key = typeof f.key === "string" ? f.key.trim() : "";
  if (!key) return { ok: false, reason: "missing_key" };

  const domain = typeof f.domain === "string" ? f.domain.trim() : "";
  if (!domain) return { ok: false, reason: "missing_domain" };

  const source = typeof f.source === "string" ? f.source.trim() : "";
  if (!source) return { ok: false, reason: "missing_source" };

  const sourceRef = typeof f.sourceRef === "string" ? f.sourceRef.trim() : "";
  if (!sourceRef) return { ok: false, reason: "missing_sourceRef" };

  if (typeof f.value === "undefined") return { ok: false, reason: "missing_value" };

  const entityId = typeof f.entityId === "string" ? f.entityId.trim() : "";
  if (entityId) return { ok: true };

  const fp = typeof f.entityFingerprint === "string" ? f.entityFingerprint.trim() : "";
  const ed = typeof f.entityDomain === "string" ? f.entityDomain.trim() : "";
  if (fp && ed) return { ok: true };

  return { ok: false, reason: "missing_entity_resolver" };
}

function stableEntityIdFromFingerprint(fpRaw: string): string {
  // Pure replacement for Firestore-based entity resolution:
  // we DO NOT create or look up entities; we just compute a stable id.
  const norm = normalizeFingerprint(fpRaw);
  const id = mapIdFromFingerprint(norm);
  return `fp:${id}`;
}

function normalizeValidityWindow(v: any): ValidityWindow | undefined {
  if (!v || typeof v !== "object") return undefined;
  const from = typeof v.from === "number" ? v.from : undefined;
  const to = typeof v.to === "number" ? v.to : undefined;
  if (from === undefined && to === undefined) return undefined;
  return { from, to };
}

function canonicalizeFactForCompare(f: any) {
  if (!f || typeof f !== "object") return f;

  const {
    // volatile Felder ignorieren
    createdAt,
    updatedAt,

    // Rest vergleichen wir
    ...rest
  } = f;

  return rest;
}

function stableEqual(a: any, b: any): boolean {
  
  return stableStringify(a) === stableStringify(b);
}

function toValidatedFactPure(f: FactInput, localeFallback: string) {
  const rawDomain = typeof (f as any).domain === "string" ? String((f as any).domain) : "generic";
  const domain = rawDomain.trim() || "generic";

  const meta = f.meta && typeof f.meta === "object" ? (f.meta as Record<string, any>) : undefined;

  // match store.ts behavior: locale from meta.locale, else fallback
  const locale =
    meta && typeof meta.locale === "string" ? String(meta.locale) : localeFallback;

  // key normalization (system keys pass through in normalizeFactKey)
  const key = normalizeFactKey(String((f as any).key ?? ""), domain as any, meta);

  // Phase 1.2 strict: reject "silent normalization" for non-system facts.
// If normalizeFactKey changes the key, we treat it as invalid input.
const rawKey = typeof (f as any).key === "string" ? String((f as any).key).trim() : "";
const isSystem = !!(meta && (meta as any).system === true);

if (!isSystem && rawKey && key !== rawKey) {
  throw new Error(`fact_rejected_key_normalized:${rawKey}=>${key}`);
}

  // value normalization
  const value = normalizeFactValueByLocale((f as any).value ?? null, locale);

  // entityId: keep if provided; else stable from fingerprint (pure)
  const entityIdRaw = typeof (f as any).entityId === "string" ? String((f as any).entityId).trim() : "";
  const fpRaw = typeof (f as any).entityFingerprint === "string" ? String((f as any).entityFingerprint) : "";
  const entityId = entityIdRaw || (fpRaw ? stableEntityIdFromFingerprint(fpRaw) : "");

  const validity = normalizeValidityWindow((f as any).validity);

  // match store.ts behavior: if meta.latest === true => stable id per (entityId+key)
  const isLatest = !!(meta && (meta as any).latest === true);

  const factId =
    typeof (f as any).factId === "string" && String((f as any).factId).trim()
      ? String((f as any).factId).trim()
      : buildFactId({
          entityId,
          key,
          value: isLatest ? "__latest__" : value,
          options: { validityWindow: validity },
        });

  return {
    factId,
    entityId,
    entityFingerprint: fpRaw ? fpRaw : undefined,
    entityDomain:
      typeof (f as any).entityDomain === "string" ? String((f as any).entityDomain) : undefined,
    entityType:
      typeof (f as any).entityType === "string" ? String((f as any).entityType) : undefined,

    domain,
    key,
    value,

    validity: validity ? { ...validity } : undefined,
    meta,

    source: typeof (f as any).source === "string" ? String((f as any).source) : undefined,
    sourceRef: typeof (f as any).sourceRef === "string" ? String((f as any).sourceRef) : undefined,
    conflict: (f as any).conflict === true ? true : undefined,
  };
}

function applyHaltungPatchPure(before: CoreHaltungV1, patch: Partial<Omit<CoreHaltungV1, "version" | "updatedAt">>): CoreHaltungV1 {
  // deriveHaltungPatchFromEvent() already clamps. We keep updatedAt unchanged for determinism.
  return {
    version: 1,
    directness: patch.directness !== undefined ? clamp01(patch.directness, before.directness) : before.directness,
    interventionDepth: patch.interventionDepth !== undefined ? clamp01(patch.interventionDepth, before.interventionDepth) : before.interventionDepth,
    patience: patch.patience !== undefined ? clamp01(patch.patience, before.patience) : before.patience,
    escalationThreshold: patch.escalationThreshold !== undefined ? clamp01(patch.escalationThreshold, before.escalationThreshold) : before.escalationThreshold,
    reflectionLevel: patch.reflectionLevel !== undefined ? clamp01(patch.reflectionLevel, before.reflectionLevel) : before.reflectionLevel,
    updatedAt: before.updatedAt,
  };
}

// -----------------------
// Main
// -----------------------

export async function runCoreOnce(input: RunCoreOnceInput): Promise<RunCoreOnceOutput> {
  // 0) Normalize input
  const userId = String(input?.userId ?? "").trim();
  if (!userId) throw new Error("runCoreOnce: userId missing");
  
  const text = String(input?.text ?? "");
  const locale = String(input?.state?.locale ?? "de-DE");

  const tierRaw = input?.state?.tier;
  const tier: "free" | "pro" = tierRaw === "pro" ? "pro" : "free";

  // Phase 6.1: [] means none, undefined means default(all)
  const extractorIds = Array.isArray(input?.extractorIds)
    ? input.extractorIds
    : listExtractors();

  const prevFacts = Array.isArray(input?.state?.facts) ? input.state!.facts! : [];
  const hBefore = normalizeHaltungPure(input?.state?.haltung);

  // 1) Build in-memory RawEvent (deterministic)
  const timestamp = 0; // strict determinism in Phase 6.1
  const ingestHash = sha256(`${userId}::${locale}::${text}`);
  const rawEventId = sha256(`rawEvent::${ingestHash}`);

  const rawEventDoc: RawEventDoc = {
    timestamp,
    sourceType: "ingest_document_text",
    userRef: userId,
    locale,
    payload: { text },
    meta: { filename: null, mimeType: null, source: null },
    ingestHash,
    dayBucket: dayBucketUTC(timestamp),
  };

  // 2) Run extractors (pure; no persistence; no entity resolution via Firestore)
  const extractorInput = toExtractorInputV1(rawEventId, rawEventDoc);

  const extractedFacts: FactInput[] = [];
  const warnings: string[] = [];
  const perExtractor: {
  extractorId: string;
  ok: boolean;
  factsIn?: number;
  factsAccepted?: number;
  error?: string;
}[] = [];

  for (const extractorId of extractorIds) {
    const ex = getExtractor(extractorId);
    if (!ex) {
      perExtractor.push({ extractorId, ok: false, error: "unknown_extractor" });
      continue;
    }

    try {
      const res = await ex.extract({
        rawEventId: extractorInput.rawEventId,
        locale: extractorInput.locale,
        sourceType: extractorInput.sourceType,
        payload: extractorInput.payload,
        meta: extractorInput.meta,
      });

      const facts = Array.isArray((res as any)?.facts) ? ((res as any).facts as FactInput[]) : [];
      const w = Array.isArray((res as any)?.warnings) ? ((res as any).warnings as string[]) : [];

      // Phase 1 strict: reject invalid facts (same rule-shape as existing runner)
const cleaned = facts.filter((f: any) => validateFactInputV1Pure(f).ok);

// Phase 4.2: chat-input facts are user claims (core rule)
const userClaimFacts = cleaned.map((f: any) => ({
  ...f,
  meta: {
    ...(f?.meta && typeof f.meta === "object" ? f.meta : {}),
    source: (f?.meta && typeof f.meta === "object" && typeof f.meta.source === "string")
      ? f.meta.source
      : "user_claim",
  },
}));

extractedFacts.push(...userClaimFacts);
warnings.push(...w);

      perExtractor.push({
        extractorId,
        ok: true,
        factsIn: facts.length,
        factsAccepted: cleaned.length,
      });
    } catch (e) {
      perExtractor.push({ extractorId, ok: false, error: String(e) });
    }
  }

// 2.5) Satellites (pure) — Phase 4.1: collect proposed facts (no writes)
  const satelliteIds = Array.isArray(input?.state?.satelliteIds)
  ? input.state!.satelliteIds
  : []; // default OFF
  const satelliteOutputs: SatelliteOutput[] = [];

  if (satelliteIds.length > 0) {

    const baseInput: Omit<SatelliteInput, "satelliteId"> = {
  userId,
  channel: "api_ingest",
  plan: { tier, flags: {} },
  guaranteedInput: {
    rawEvent: {
      rawEventId,
      sourceType: "document",
      payload: {
        text,
        // KEINE nulls -> weglassen
      },
      meta: { userRef: userId, tier },
    },
    existingFacts: prevFacts.map((f: any) => ({
      factId: f.factId,
      domain: f.domain,
      key: f.key,
      value: f.value,
      meta: f.meta,
    })),
    metaSnapshot: { locale, now: 0, timezone: "UTC", flags: {} },
  },
};

    for (const satIdRaw of satelliteIds) {
      const satId = String(satIdRaw ?? "").trim();
      if (!satId) continue;

      const def = getSatellite(satId);
      if (!def) {
        warnings.push(`satellite_missing:${satId}`);
        continue;
      }

      try {
        const outSat = await def.run({ ...baseInput, satelliteId: satId });
        satelliteOutputs.push(outSat);
      } catch (e) {
        warnings.push(`satellite_failed:${satId}:${String(e)}`);
      }
    }
  }

  // Map satellite propose_facts -> FactInput (still goes through strict validation below)
  const proposedFacts: FactInput[] = [];
  for (const sOut of satelliteOutputs) {
    if (!sOut || (sOut as any).ok !== true) continue;

    const suggestions = Array.isArray((sOut as any).suggestions) ? (sOut as any).suggestions : [];
    for (const sug of suggestions) {
      if (!sug || sug.kind !== "propose_facts") continue;

      const facts = Array.isArray(sug.facts) ? sug.facts : [];
      for (const pf of facts) {
        const domainRaw = String(pf?.domain ?? "").trim();
if (!domainRaw) continue;

// HARD FREEZE GATE
if (!(FROZEN.domains as readonly string[]).includes(domainRaw)) continue;

// typed domain (throws if not frozen-allowed)
const domain = toEntityDomain(domainRaw);
        const key = String(pf?.key ?? "").trim();
        const sourceRef = String(pf?.sourceRef ?? "").trim();

        if (!domain || !key || !sourceRef) continue;

        // HARD FREEZE GATE
        if (!(FROZEN.domains as readonly string[]).includes(domain)) continue;
        if (!(FROZEN.factKeys as readonly string[]).includes(key)) continue;

        // Entity Strategy (deterministic, stable per user)
        const entityFingerprint = `user:${userId}::doc_summary`;

        const meta = pf?.meta && typeof pf.meta === "object" ? pf.meta : undefined;

        proposedFacts.push({
          domain,
          key,
          value: typeof pf?.value === "undefined" ? null : pf.value,

          // IMPORTANT: NOT raw_event (otherwise extractor freeze rejects)
          source: "other",
          sourceRef,

          entityDomain: domain,
          entityType: "document",
          entityFingerprint,

          meta: {
            ...(meta ?? {}),
            system: true,
            latest: true,
            locale,
            satelliteId: (sOut as any).satelliteId,
          },
        });
      }
    }
  }

  // feed into the normal pipeline
  if (proposedFacts.length > 0) {
    extractedFacts.push(...proposedFacts);
  }



  // 3) Validate + normalize + compute factIds (pure) + Phase 1.2 strict validation
const validatedFacts: RunCoreOnceOutput["validatedFacts"] = [];

// Phase 4.2: collect conflicts
const conflictEvents: ConflictEventV1[] = [];

for (const f of extractedFacts) {
  const v = validateFactInputV1Pure(f);
  if (!v.ok) continue;

  let vf: any;
  try {
    vf = toValidatedFactPure(f, locale);
  } catch (e) {
    // Phase 1.2: reject instead of "correcting" (do NOT crash the run)
    warnings.push(`fact_rejected_toValidatedFact_error:${String(e)}`);
    continue;
  }

  // Hard guard: must have key + entityId + factId
  if (!vf.key || !vf.entityId || !vf.factId) {
    warnings.push("fact_rejected_missing_core_fields");
    continue;
  }

  // Phase 1.2: domain must be frozen-allowed
  const domain = String(vf.domain ?? "").trim();
  if (!domain || !(FROZEN.domains as readonly string[]).includes(domain)) {
    warnings.push(`fact_rejected_domain_not_frozen:${domain || "EMPTY"}`);
    continue;
  }

  // Phase 1.2: extractorId must be frozen-allowed (only enforce for raw_event sourced facts)
  const source = String(vf.source ?? "").trim();
  const extractorId = String(vf.meta?.extractorId ?? "").trim();

  if (source === "raw_event") {
    if (!extractorId) {
      warnings.push("fact_rejected_missing_extractorId");
      continue;
    }
    if (!(FROZEN.extractors as readonly string[]).includes(extractorId)) {
      warnings.push(`fact_rejected_extractor_not_frozen:${extractorId}`);
      continue;
    }
  }

  validatedFacts.push(vf);
}

// 3.5) Phase 4.2 — user overrides document (pure)
// Rule: if a user_claim exists for same (entityId,key) and value differs,
// mark the non-user fact as conflict=true and emit debug conflict events.
// No writes, no chat output.

const userClaimByEntityKey = new Map<string, any>();
for (const f of validatedFacts) {
  const src = String((f as any)?.meta?.source ?? "").trim();
  if (src !== "user_claim") continue;
  const k = `${String((f as any).entityId)}::${String((f as any).key)}`;
  // first one wins deterministically (validatedFacts order is deterministic)
  if (!userClaimByEntityKey.has(k)) userClaimByEntityKey.set(k, f);
}

const validatedFactsWithConflicts = validatedFacts.map((f: any) => {
  const src = String(f?.meta?.source ?? "").trim();
  if (src === "user_claim") return f;

  const k = `${String(f.entityId)}::${String(f.key)}`;
  const u = userClaimByEntityKey.get(k);
  if (!u) return f;

  const sameValue = stableStringify(u.value) === stableStringify(f.value);
  if (sameValue) return f;

  // mark document/non-user fact as conflicted
  conflictEvents.push({
    entityId: String(f.entityId),
    key: String(f.key),
    userValue: u.value,
    docValue: f.value,
    userFactId: String(u.factId ?? ""),
    docFactId: String(f.factId ?? ""),
  });

  return { ...f, conflict: true };
});

const finalFacts = validatedFactsWithConflicts;

// replace for downstream steps
validatedFacts.length = 0;
validatedFacts.push(...validatedFactsWithConflicts);

  // 4) factsDiff (pure) — NEW vs UPDATED vs IGNORED
const diffNew: string[] = [];
const diffUpdated: string[] = [];
const diffIgnored: string[] = [];

const changes: {
  factId: string;
  kind: "new" | "updated" | "ignored";
  key: string;
  entityId: string;
}[] = [];

// Map: prev facts by factId (schnell)
const prevById = new Map<string, any>();
for (const pf of prevFacts) {
  const id = String((pf as any)?.factId ?? "").trim();
  if (id) prevById.set(id, pf);
}

for (const f of finalFacts) {
  const prev = prevById.get(f.factId);

  if (!prev) {
    diffNew.push(f.factId);
    changes.push({ factId: f.factId, kind: "new", key: f.key, entityId: f.entityId });
    continue;
  }

  // Vergleich: prev vs next (ohne volatile timestamps)
  const prevCanon = canonicalizeFactForCompare(prev);
  const nextCanon = canonicalizeFactForCompare({
    factId: f.factId,
    entityId: f.entityId,
    domain: f.domain,
    key: f.key,
    value: f.value,
    validity: f.validity ?? null,
    meta: f.meta ?? null,
    source: f.source ?? null,
    sourceRef: f.sourceRef ?? null,
    conflict: f.conflict ?? false,
  });

  const same = stableEqual(prevCanon, nextCanon);

  if (same) {
    diffIgnored.push(f.factId);
    changes.push({ factId: f.factId, kind: "ignored", key: f.key, entityId: f.entityId });
  } else {
    diffUpdated.push(f.factId);
    changes.push({ factId: f.factId, kind: "updated", key: f.key, entityId: f.entityId });
  }
}

  // 5) Haltung (pure)
  const triggers = computeHaltungTriggersFromMessage({ message: text });

  const learningEvent = detectHaltungLearningEventFromMessage(text);
  const patch =
    learningEvent ? deriveHaltungPatchFromEvent(hBefore, learningEvent) : {};

  const hAfter = applyHaltungPatchPure(hBefore, patch);

  // 6) Intervention (pure)
  const intervention = computeCoreInterventionV1({
    message: text,
    haltung: hAfter,
    triggerRes: triggers,
  });

  return {
  rawEvent: { rawEventId, doc: rawEventDoc },
  validatedFacts: finalFacts,
  conflicts: conflictEvents,
  factsDiff: { new: diffNew, updated: diffUpdated, ignored: diffIgnored },
  factsChanges: changes,

  haltungDelta: {
    before: hBefore,
    after: hAfter,
    patch,
    learningEvent: learningEvent ? { ...learningEvent } : null,
    triggers,
  },

  intervention,
  effects: { writesPlanned: false },

  debug: {
    extractorIds,
    warningsCount: warnings.length,
    extractedFactsCount: extractedFacts.length,
    validatedFactsCount: validatedFacts.length,
    perExtractor,

    // nur Debug, bounded
    satellites: {
      requested: satelliteIds,
      ran: satelliteOutputs
        .map((o: any) => {
  const insights = Array.isArray(o?.insights) ? o.insights : [];

  const digestGate =
    insights.find((i: any) => i?.code === "digest_plan_gate")?.data ?? null;

  return {
    satelliteId: o?.satelliteId,
    ok: o?.ok === true,
    insightsCount: insights.length,
    suggestionsKinds: Array.isArray(o?.suggestions)
      ? o.suggestions.map((s: any) => s?.kind).filter(Boolean).slice(0, 10)
      : [],
    digest_plan_gate: digestGate,
  };
})
        .slice(0, 5),
    },

    conflicts: {
  count: conflictEvents.length,
  sample: conflictEvents.slice(0, 10),
},

  },
};
}