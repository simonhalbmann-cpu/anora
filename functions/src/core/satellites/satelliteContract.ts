// functions/src/core/satellites/satelliteContract.ts
// OFFICIAL SATELLITE CONTRACT (Core-controlled, pure)
//
// HARD RULES (enforced by architecture + lint later):
// - No Firestore access
// - No writes, no side effects
// - No external API calls
// - Stateless & swappable
//
// "Core thinks. Satellites see further."

/** Plan / Freemium gating */
export type PlanTier = "free" | "pro";

/** Where did this input come from? (input channels) */
export type InputChannel =
  | "chat_text"
  | "doc_upload"
  | "doc_scan"
  | "folder_scan"
  | "api_ingest"
  | "system_job";

/** Minimal, stable snapshot the Core can give to satellites (readonly) */
export type SatelliteMetaSnapshot = {
  locale?: string;          // e.g. "de-DE"
  now?: number;             // epoch ms
  timezone?: string;        // e.g. "Europe/Berlin"
  appVersion?: string;
  flags?: Record<string, boolean>;
};

/** Facts are read-only for satellites. Keep this generic on purpose. */
export type ReadonlyFact = {
  factId: string;
  domain: string;
  key: string;
  value: any;
  meta?: Record<string, any>;
};

/** RawEvent is the normalized input (text, document, etc.) */
export type SatelliteRawEvent = {
  rawEventId: string;
  sourceType: "text" | "document" | "unknown";
  payload: {
    text?: string;                 // extracted text if available
    filename?: string;
    mimeType?: string;
    pages?: number;
    textChars?: number;
    isScanned?: boolean;
    hasTables?: boolean;
    quality?: "low" | "medium" | "high";
  };
  meta?: Record<string, any>;      // e.g. userRef, uploadId, etc.
};

/** Input given to every satellite (standardized) */
export type SatelliteInput = {
  satelliteId: string;            // filled by core (safety/observability)
  userId: string;                 // stable user scope
  channel: InputChannel;

  plan: {
    tier: PlanTier;
    // room for: quotas, limits, feature flags, experiments
    flags?: Record<string, boolean>;
  };

  guaranteedInput: {
    rawEvent: SatelliteRawEvent;
    existingFacts: ReadonlyFact[];
    metaSnapshot: SatelliteMetaSnapshot;
  };
};

/** Output building blocks (strict, prompting-safe, no free-text essays) */
export type SatelliteInsight = {
  code: string;                   // e.g. "doc_type_detected"
  data?: Record<string, any>;     // bounded structured payload
};

export type SatelliteHypothesis = {
  code: string;                   // e.g. "likely_rent_change"
  confidence: number;             // 0..1
  data?: Record<string, any>;
};

export type SatelliteRisk = {
  code: string;                   // e.g. "deadline_soon"
  severity: "low" | "medium" | "high";
  confidence?: number;            // optional 0..1
  data?: Record<string, any>;
};

export type SatelliteSuggestion =
  | {
      kind: "propose_facts";
      facts: Array<{
        domain: string;
        key: string;
        value: any;
        // IMPORTANT: satellites never write; sourceRef MUST allow traceability
        sourceRef: string; // e.g. rawEventId or docId
        meta?: Record<string, any>; // confidence, extractorId, etc.
      }>;
    }
  | {
      kind: "propose_tasks";
      tasks: Array<{
        code: string;             // deterministic label
        data?: Record<string, any>;
      }>;
    }
  | {
      kind: "needs_user_confirmation";
      questionCode: string;       // no prose; brain layer can render later
      data?: Record<string, any>;
    }
  | {
      kind: "digest_only";
      data: Record<string, any>;  // daily summary material
    };

export type SatelliteScores = Record<string, number>; // bounded numeric signals

/** Strict satellite output */
export type SatelliteOutput = {
  ok: true;
  satelliteId: string;
  version: 1;

  insights: SatelliteInsight[];
  hypotheses: SatelliteHypothesis[];
  risks: SatelliteRisk[];
  suggestions: SatelliteSuggestion[];
  scores: SatelliteScores;

  // optional: test/debug only (never shown to users)
  debug?: Record<string, any>;
} | {
  ok: false;
  satelliteId: string;
  version: 1;
  error: { code: string; message: string };
  debug?: Record<string, any>;
};

/** A satellite is a pure analyzer */
export type Satellite = {
  id: string;
  version: 1;
  analyze: (input: SatelliteInput) => Promise<SatelliteOutput>;
};