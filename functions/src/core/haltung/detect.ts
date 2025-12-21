// functions/src/core/haltung/detect.ts
// PHASE 3.3: deterministische Lern-Events aus User-Text (ohne KI)

import type { HaltungLearningEvent } from "./learn";

function includesAny(haystack: string, needles: string[]): boolean {
  const s = String(haystack || "").toLowerCase();
  return needles.some((n) => s.includes(n));
}

// Sehr konservativ: nur klare, explizite Feedback-Signale
export function detectHaltungLearningEventFromMessage(message: string): HaltungLearningEvent | null {
  const msg = String(message || "").trim().toLowerCase();
  if (!msg) return null;

  // 1) Explizite Ablehnung / Stop
  if (
    includesAny(msg, [
      "lass das",
      "hör auf",
      "hoer auf",
      "nicht mehr",
      "stopp",
      "stop",
      "nein,",
      "nein.",
      "nein ",
      "das will ich nicht",
      "so nicht",
      "zu viel",
      "zu hart",
      "zu direkt",
    ])
  ) {
    return { type: "explicit_rejection", strength: 0.2 };
  }

  // 2) Bestätigter Nutzen
  if (
    includesAny(msg, [
      "hat geholfen",
      "hilfreich",
      "gut so",
      "genau",
      "passt",
      "super",
      "danke",
      "verstanden",
      "ok, machen wir so",
      "ja machen wir so",
      "ja, machen wir so",
    ])
  ) {
    return { type: "confirmed_helpful", strength: 0.15 };
  }

  return null;
}