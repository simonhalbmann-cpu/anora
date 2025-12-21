/**
 * PHASE 4.1: Interventions-Controller – harte Stufen (Core-intern, deterministisch)
 * - Keine Texte, kein Prompting, keine UI
 * - Nur technische Entscheidung: observe|hint|recommend|contradict
 */

export type InterventionLevel =
  | "observe"
  | "hint"
  | "recommend"
  | "contradict";

export type CoreInterventionV1 = {
  version: 1;
  level: InterventionLevel;

  /**
   * Deterministische Gründe (keine freien Texte).
   * Beispiele: "trigger:decision_near", "depth:high", "escalation:low_threshold"
   */
  reasonCodes: string[];

  /**
   * Optionales Debug für Logs/Tests (keine User-Ausgabe).
   */
  debug?: Record<string, any>;
};