// functions/src/core/facts/factMeta.ts

/**
 * Globale Meta-Information für JEDEN Fakt in Anora.
 * Satelliten dürfen nur FELDER BEFÜLLEN – keine Logik.
 */
export type FactMetaV1 = {
  /** Woher kommt die Information? */
  sourceType:
    | "user_direct"
    | "contract"
    | "official_document"
    | "email"
    | "expose"
    | "raw_event"
    | "inference"
    | "other";

  /** Welcher Satellit hat den Fakt erzeugt? */
  satelliteId: string;

  /** Wie zuverlässig ist die Quelle an sich? (0–1) */
  sourceReliability: number;

  /** Wie sicher ist sich der Satellit selbst? (0–1) */
  confidence: number;

  /** Zeitliche Einordnung */
  temporal:
    | "final"
    | "amended"
    | "preliminary"
    | "unknown";

  /** Benutzer hat explizit bestätigt */
  userConfirmed?: boolean;

  /** Technische Marker */
  system?: boolean;
  latest?: boolean;
};

// --------------------------------------------------
// Normalisierung: erzwingt konsistentes Fact-Meta
// --------------------------------------------------

export function normalizeFactMeta(
  raw: Partial<FactMetaV1>,
  satelliteId: string
): FactMetaV1 {
  return {
    sourceType: raw.sourceType ?? "other",

    satelliteId,

    sourceReliability:
      typeof raw.sourceReliability === "number"
        ? clamp01(raw.sourceReliability)
        : 0.5,

    confidence:
      typeof raw.confidence === "number"
        ? clamp01(raw.confidence)
        : 0.5,

    temporal: raw.temporal ?? "unknown",

    userConfirmed: raw.userConfirmed === true,

    system: raw.system === true,
    latest: raw.latest === true,
  };
}

// Hilfsfunktion: Zahl sicher auf 0..1 begrenzen
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}