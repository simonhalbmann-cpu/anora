// functions/src/core/haltung/learn.ts
// PHASE 3.3: Lernlogik strikt begrenzen (deterministisch)

import type { CoreHaltungV1 } from "./types";

export type HaltungLearningEvent =
  | { type: "explicit_rejection"; strength?: number }   // User: "nein", "lass das", "hör auf"
  | { type: "confirmed_helpful"; strength?: number }    // User: "ja genau", "hat geholfen"
  | { type: "ignored_over_time"; strength?: number };   // später: aus Meta/History

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function deriveHaltungPatchFromEvent(
  current: CoreHaltungV1,
  ev: HaltungLearningEvent
): Partial<Omit<CoreHaltungV1, "version" | "updatedAt">> {
  const s = clamp01(typeof ev.strength === "number" ? ev.strength : 0.2);

  switch (ev.type) {
    case "explicit_rejection":
      return {
        directness: clamp01(current.directness - s),
        interventionDepth: clamp01(current.interventionDepth - s),
      };

    case "confirmed_helpful":
      return {
        interventionDepth: clamp01(current.interventionDepth + s),
        reflectionLevel: clamp01(current.reflectionLevel + s * 0.5),
      };

    case "ignored_over_time":
      return {
        patience: clamp01(current.patience - s),
      };

    default:
      return {};
  }
}