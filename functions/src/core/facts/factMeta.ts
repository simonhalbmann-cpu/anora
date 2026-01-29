// functions/src/core/facts/factMeta.ts
// PHASE 1.1 — FactMetaV1 + Normalizer
// Core-owned, deterministic

export type FactFinality = "draft" | "final";

export type FactSourceType =
  | "user"
  | "contract"
  | "expose"
  | "email"
  | "document"
  | "system"
  | "other";

export type FactMetaV1 = {
  version: 1;

  // Herkunft
  sourceType: FactSourceType;

  // Qualität
  confidence?: number;          // 0..1
  sourceReliability?: number;   // 0..1

  // Systemflags
  system?: boolean;
  latest?: boolean;

  // User-Override
  override?: boolean;
  finality?: FactFinality;

  // Herkunft (Core)
  extractorId?: string;
  

  // Zeit
  temporal?: "past" | "present" | "future" | "unknown";
};

export function normalizeFactMeta(
  raw: any,
  fallback?: Partial<FactMetaV1>
): FactMetaV1 {
  const meta = { ...(raw ?? {}) };

  return {
    version: 1,

    sourceType:
      meta.sourceType ??
      fallback?.sourceType ??
      "other",

    confidence:
      typeof meta.confidence === "number"
        ? Math.max(0, Math.min(1, meta.confidence))
        : fallback?.confidence,

    sourceReliability:
      typeof meta.sourceReliability === "number"
        ? Math.max(0, Math.min(1, meta.sourceReliability))
        : fallback?.sourceReliability,

    system: meta.system === true,
    latest: meta.latest === true,

    override: meta.override === true,
    finality:
      meta.finality === "final" ? "final" : "draft",

    extractorId:
      typeof meta.extractorId === "string"
        ? meta.extractorId
        : fallback?.extractorId,

    temporal:
      meta.temporal === "past" ||
      meta.temporal === "present" ||
      meta.temporal === "future"
        ? meta.temporal
        : "unknown",
  };
}