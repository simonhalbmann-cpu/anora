// functions/src/core/haltung/detect.ts
// PHASE 3.3: deterministische Lern-Events aus User-Text (ohne KI)

import type { HaltungLearningEvent } from "./learn";

function includesAny(haystack: string, needles: string[]): boolean {
  const s = String(haystack || "").toLowerCase();
  return needles.some((n) => s.includes(n));
}

// Sehr konservativ: nur klare, explizite Feedback-Signale
export function detectHaltungLearningEventFromMessage(
  message: string
): HaltungLearningEvent | null {
  const msg = String(message || "").trim().toLowerCase();
  if (!msg) return null;

  // 1) Explizite Ablehnung / Stop
  // (bewusst ganz oben: wenn User "zu direkt" sagt, zählt das als Ablehnung)
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
      "zu aggressiv",
      "zu konfrontativ",
      "weniger hart",
      "bitte freundlicher",
      "bitte vorsichtiger",
      "sei netter",
    ])
  ) {
    return { type: "explicit_rejection", strength: 0.2 };
  }

  // 2) Explizit: User will HÄRTER / direkter
  if (
    includesAny(msg, [
      "sei direkter",
      "sei härter",
      "sei haerter",
      "knallhart",
      "mach druck",
      "klare kante",
      "widersprich mir",
      "konfrontier",
      "konfrontiere",
      "geh tiefer",
    ])
  ) {
    return { type: "wants_harsher", strength: 0.08 };
  }

  // 3) Detailgrad (widerspruchsfest)
  const wantsMoreDetail = includesAny(msg, [
    "mehr details",
    "geh ins detail",
    "erklär genauer",
    "erklaer genauer",
    "bitte ausführlich",
    "bitte ausfuehrlich",
    "ich will es genau verstehen",
  ]);

  const wantsLessDetail = includesAny(msg, [
    "zu lang",
    "kürzer",
    "kuerzer",
    "bitte kurz",
    "nur kurz",
    "fass zusammen",
  ]);

  if (wantsMoreDetail && !wantsLessDetail) {
    return { type: "wants_more_detail", strength: 0.08 };
  }
  if (wantsLessDetail && !wantsMoreDetail) {
    return { type: "wants_less_detail", strength: 0.08 };
  }

  // 4) Eskalationsbremse
  if (
    includesAny(msg, [
      "nicht eskalieren",
      "bitte nicht eskalieren",
      "kein anwalt",
      "kein gericht",
      "keine abmahnung",
      "ruhig bleiben",
    ])
  ) {
    return { type: "avoid_escalation", strength: 0.08 };
  }

  // 5) Bestätigter Nutzen (NUR wenn es wirklich Feedback ist, nicht Höflichkeit)
  if (
    includesAny(msg, [
      "hat geholfen",
      "hilfreich",
      "das war hilfreich",
      "das hat geholfen",
    ])
  ) {
    return { type: "confirmed_helpful", strength: 0.15 };
  }

  return null;
}