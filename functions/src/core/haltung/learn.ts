// functions/src/core/haltung/learn.ts
// PHASE 3.3: Lernlogik strikt begrenzen (deterministisch)

import type { CoreHaltungV1 } from "./types";

export type HaltungLearningEvent =
  | { type: "explicit_rejection"; strength?: number }
  | { type: "confirmed_helpful"; strength?: number }
  | { type: "wants_harsher"; strength?: number }
  | { type: "wants_softer"; strength?: number }
  | { type: "wants_more_detail"; strength?: number }
  | { type: "wants_less_detail"; strength?: number }
  | { type: "avoid_escalation"; strength?: number }
  | { type: "ignored_over_time"; strength?: number };

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Diminishing-Returns Schritt:
 * - am Anfang ~s
 * - nahe an den Rändern wird der Schritt kleiner
 *
 * Konstruktion:
 *  - Richtung 1: delta = min(s, 2*s*(1-x))
 *    -> bis x<=0.5 volle s, danach zunehmend kleiner
 *  - Richtung 0: delta = min(s, 2*s*x)
 */
function stepToward1(x: number, s: number): number {
  const xx = clamp01(x);
  const ss = clamp01(s);
  const delta = Math.min(ss, 2 * ss * (1 - xx));
  return clamp01(xx + delta);
}

function stepToward0(x: number, s: number): number {
  const xx = clamp01(x);
  const ss = clamp01(s);
  const delta = Math.min(ss, 2 * ss * xx);
  return clamp01(xx - delta);
}

export function deriveHaltungPatchFromEvent(
  current: CoreHaltungV1,
  ev: HaltungLearningEvent
): Partial<Omit<CoreHaltungV1, "version" | "updatedAt">> {
  // Große Events bleiben kräftiger, Tone-Commands bleiben klein.
  const fallback =
    ev.type === "explicit_rejection" || ev.type === "confirmed_helpful"
      ? 0.2
      : 0.08;

  const s = clamp01(typeof ev.strength === "number" ? ev.strength : fallback);

  switch (ev.type) {
    case "explicit_rejection":
      return {
        directness: stepToward0(current.directness, s),
        interventionDepth: stepToward0(current.interventionDepth, s),
      };

    case "confirmed_helpful":
      return {
        interventionDepth: stepToward1(current.interventionDepth, s),
        reflectionLevel: stepToward1(current.reflectionLevel, s * 0.5),
      };

    case "wants_harsher":
      return {
        directness: stepToward1(current.directness, s),
        interventionDepth: stepToward1(current.interventionDepth, s),
        // Gegengewicht: etwas weniger Geduld (auch diminishing)
        patience: stepToward0(current.patience, s * 0.5),
      };

    case "wants_softer":
      return {
        directness: stepToward0(current.directness, s),
        interventionDepth: stepToward0(current.interventionDepth, s),
        patience: stepToward1(current.patience, s * 0.5),
      };

    case "wants_more_detail":
      return {
        reflectionLevel: stepToward1(current.reflectionLevel, s),
      };

    case "wants_less_detail":
      return {
        reflectionLevel: stepToward0(current.reflectionLevel, s),
      };

    case "avoid_escalation":
      return {
        escalationThreshold: stepToward1(current.escalationThreshold, s),
      };

    case "ignored_over_time":
      return {
        patience: stepToward0(current.patience, s),
      };

    default:
      return {};
  }
}