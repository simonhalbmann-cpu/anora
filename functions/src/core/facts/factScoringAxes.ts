// functions/src/core/facts/factScoringAxes.ts

/**
 * PHASE 2.1
 * Zentrale, globale Definition aller Bewertungsachsen für Facts.
 *
 * WICHTIG:
 * - Diese Datei enthält NUR Struktur + Bedeutung
 * - KEINE Logik
 * - KEINE Gewichtung
 * - KEINE Scores
 *
 * Jede spätere Bewertung MUSS sich auf diese Achsen beziehen.
 */

/**
 * Feste Liste aller Score-Achsen (max. 8, global, freeze-stabil)
 */
export type FactScoreAxis =
  | "source_reliability"   // Wie verlässlich ist die Quelle grundsätzlich?
  | "finality"             // Entwurfsstatus: draft / interim / final
  | "recency"              // Zeitliche Nähe / Aktualität
  | "user_override"        // Explizite User-Entscheidung
  | "system_penalty"       // System-/Derived-Facts NICHT automatisch bevorzugen
  | "consistency_hint"     // Gleiche Values => kein echter Konflikt
  | "specificity_hint"     // Strukturierter > heuristisch (nur deterministisch)
  | "completeness_hint";   // Mehr vollständig ausgefüllte Werte

/**
 * Metadaten-Beschreibung je Achse.
 * Rein dokumentarisch – keine Logik.
 */
export type FactScoreAxisInfo = {
  axis: FactScoreAxis;

  /** Kurzbeschreibung für Entwickler */
  description: string;

  /**
   * Erwarteter Wertebereich dieser Achse
   * (z.B. 0..1, boolean, enum → später normalisiert)
   */
  valueDomain: string;

  /**
   * Darf diese Achse ALLEIN einen Winner erzwingen?
   * (z.B. user_override = ja)
   */
  canDominate: boolean;
};

/**
 * Zentrale Achsen-Registry (rein deklarativ)
 */
export const FACT_SCORE_AXES: FactScoreAxisInfo[] = [
  {
    axis: "source_reliability",
    description: "Grundvertrauen in die Quelle (Vertrag > E-Mail > Hörensagen)",
    valueDomain: "number (0..1)",
    canDominate: false,
  },
  {
    axis: "finality",
    description: "Finalität der Quelle (Entwurf, vorläufig, final)",
    valueDomain: "enum",
    canDominate: false,
  },
  {
    axis: "recency",
    description: "Zeitliche Aktualität der Information",
    valueDomain: "number (timestamp-based)",
    canDominate: false,
  },
  {
    axis: "user_override",
    description: "Explizite Entscheidung des Users",
    valueDomain: "boolean",
    canDominate: true,
  },
  {
    axis: "system_penalty",
    description: "Abwertung rein systemischer/abgeleiteter Facts",
    valueDomain: "boolean",
    canDominate: false,
  },
  {
    axis: "consistency_hint",
    description: "Gleiche Values → eher Zusammenführung als Konflikt",
    valueDomain: "boolean",
    canDominate: false,
  },
  {
    axis: "specificity_hint",
    description: "Strukturierter Wert schlägt vagen",
    valueDomain: "boolean",
    canDominate: false,
  },
  {
    axis: "completeness_hint",
    description: "Vollständig ausgefüllte Werte bevorzugen",
    valueDomain: "boolean",
    canDominate: false,
  },
];