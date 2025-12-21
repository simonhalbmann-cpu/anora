// functions/src/core/haltung/learning.ts
// PHASE 3.3: Lernlogik strikt begrenzen (deterministisch, nur explizites Feedback)

import { patchCoreHaltungV1 } from "./store";
import type { CoreHaltungV1 } from "./types";

type HaltungPatch = Partial<Omit<CoreHaltungV1, "version" | "updatedAt">>;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

function mergePatch(base: HaltungPatch, add: HaltungPatch): HaltungPatch {
  return { ...base, ...add };
}

function hasAnyPatch(p: HaltungPatch): boolean {
  return Object.keys(p).length > 0;
}

// Sehr bewusst: nur klare Phrasen.
// Keine Synonym-Lawine, sonst lernt es “aus Versehen”.
function includesAny(s: string, phrases: string[]): boolean {
  const t = s.toLowerCase();
  return phrases.some((p) => t.includes(p));
}

// Kleine, feste Schrittweite (damit nichts “kippt”)
const STEP = 0.08;

/**
 * Liefert einen Patch, wenn (und nur wenn) der Nutzer explizit Feedback zur Art/Strenge gibt.
 * Deterministisch: gleiche Nachricht => gleicher Patch.
 */
export function computeHaltungLearningPatchFromMessage(message: string): {
  patch: HaltungPatch;
  reason: string | null;
  debug: Record<string, any>;
} {
  const msg = String(message || "").trim();
  const m = msg.toLowerCase();

  let patch: HaltungPatch = {};
  let reason: string | null = null;

  // -------------------------
  // 1) Explizite Ablehnung: zu hart / zu direkt / zu aggressiv
  // -------------------------
  const tooHarsh = includesAny(m, [
    "zu hart",
    "zu direkt",
    "zu aggressiv",
    "zu konfrontativ",
    "weniger hart",
    "bitte freundlicher",
    "bitte vorsichtiger",
    "sei netter",
  ]);

  if (tooHarsh) {
    patch = mergePatch(patch, {
      directness: clamp01(0.5 - STEP),         // etwas weicher
      interventionDepth: clamp01(0.5 - STEP),  // weniger Eingriff
      patience: clamp01(0.5 + STEP),           // mehr Geduld
    });
    reason = "explicit_negative_tone";
  }

  // -------------------------
  // 2) Explizite Bestätigung: “sei direkter / knallhart / mach Druck”
  // -------------------------
  const wantsHarsher = includesAny(m, [
    "sei direkter",
    "sei härter",
    "knallhart",
    "mach druck",
    "konfrontier ihn",
    "geh tiefer",
    "widersprich mir",
    "ich will klare kante",
  ]);

  if (wantsHarsher) {
    patch = mergePatch(patch, {
      directness: clamp01(0.5 + STEP),
      interventionDepth: clamp01(0.5 + STEP),
      patience: clamp01(0.5 - STEP),
    });
    reason = reason ? `${reason}+explicit_positive_tone` : "explicit_positive_tone";
  }

  // -------------------------
  // 3) Explizite Länge/Detail: “kurz” vs “mehr Details”
  // -------------------------
  const wantsMoreDetail = includesAny(m, [
    "mehr details",
    "geh ins detail",
    "erklär genauer",
    "bitte ausführlich",
    "ich will es genau verstehen",
  ]);

  const wantsShorter = includesAny(m, [
    "zu lang",
    "kürzer",
    "bitte kurz",
    "nur kurz",
    "fass zusammen",
  ]);

  if (wantsMoreDetail && !wantsShorter) {
    patch = mergePatch(patch, {
      reflectionLevel: clamp01(0.5 + STEP),
    });
    reason = reason ? `${reason}+explicit_more_detail` : "explicit_more_detail";
  }

  if (wantsShorter && !wantsMoreDetail) {
    patch = mergePatch(patch, {
      reflectionLevel: clamp01(0.5 - STEP),
    });
    reason = reason ? `${reason}+explicit_less_detail` : "explicit_less_detail";
  }

  // -------------------------
  // 4) Explizite Eskalationsbremse: “nicht eskalieren / kein Anwalt”
  // -------------------------
  const avoidEscalation = includesAny(m, [
    "nicht eskalieren",
    "bitte nicht eskalieren",
    "kein anwalt",
    "kein gericht",
    "keine abmahnung",
    "ruhig bleiben",
  ]);

  if (avoidEscalation) {
    patch = mergePatch(patch, {
      escalationThreshold: clamp01(0.7 + STEP), // seltener eskalieren
    });
    reason = reason ? `${reason}+explicit_avoid_escalation` : "explicit_avoid_escalation";
  }

  // Wichtig: Wenn sich Signale widersprechen (z.B. “kürzer” + “mehr Details”),
  // dann patchen wir in dem Bereich NICHT (siehe checks oben).

  const debug = {
    msgPreview: msg.slice(0, 160),
    signals: {
      tooHarsh,
      wantsHarsher,
      wantsMoreDetail,
      wantsShorter,
      avoidEscalation,
    },
  };

  // Wenn gar kein Patch -> reason null lassen
  if (!hasAnyPatch(patch)) {
    return { patch: {}, reason: null, debug };
  }

  return { patch, reason, debug };
}

/**
 * Wendet den Patch an (wenn vorhanden).
 * NUR hier wird wirklich gespeichert.
 */
export async function applyHaltungLearningIfAny(opts: {
  userId: string;
  message: string;
}): Promise<{ applied: boolean; reason: string | null; patch: HaltungPatch }> {
  const { userId, message } = opts;

  const res = computeHaltungLearningPatchFromMessage(message);
  if (!hasAnyPatch(res.patch)) {
    return { applied: false, reason: null, patch: {} };
  }

  // Persist nur wenn Patch existiert (strict!)
  await patchCoreHaltungV1(userId, res.patch);

  return { applied: true, reason: res.reason, patch: res.patch };
}