/**
 * PHASE 4.1: deterministischer Interventions-Controller (Core)
 *
 * Input: Haltung (numerisch), Trigger (deterministisch), Message
 * Output: nur Level + ReasonCodes
 *
 * Regeln:
 * - Kein Freestyle, keine Texte
 * - Keine Randomness
 * - Gleiche Inputs => gleicher Output
 */

import type { HaltungTriggerResult } from "../haltung/triggers";
import type { CoreHaltungV1 } from "../haltung/types";
import type { CoreInterventionV1, InterventionLevel } from "./types";

type ComputeInterventionInput = {
  message: string;
  haltung: CoreHaltungV1;
  triggerRes: HaltungTriggerResult;
};

function clamp01(n: any, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

export function computeCoreInterventionV1(
  input: ComputeInterventionInput
): CoreInterventionV1 {
  const msg = String(input?.message ?? "");
  const h = input?.haltung as any;

  // Haltung defensiv normalisieren
  const directness = clamp01(h?.directness, 0.5);
  const interventionDepth = clamp01(h?.interventionDepth, 0.5);
  const patience = clamp01(h?.patience, 0.5);
  const escalationThreshold = clamp01(h?.escalationThreshold, 0.7);
  const reflectionLevel = clamp01(h?.reflectionLevel, 0.5);

  const triggers = Array.isArray(input?.triggerRes?.triggers)
    ? input.triggerRes.triggers
    : [];

  const hasDecision = triggers.includes("decision_near");
  const hasEscalation = triggers.includes("escalation_marker");
  const hasRepeat = triggers.includes("repeat_pattern");
  const hasContradiction = triggers.includes("contradiction");

  // Score-Basis: wie “eingreifbereit” ist die Haltung?
  let score = 0;
  score += interventionDepth * 0.55;
  score += (1 - patience) * 0.30;
  score += directness * 0.15;

  // Trigger addieren (hart, deterministisch)
  if (hasDecision) score += 0.35;
  if (hasEscalation) score += 0.45;
  if (hasContradiction) score += 0.40;
  if (hasRepeat) score += 0.25;

  // Eskalations-Schwelle wirkt als Bremse
  score -= (escalationThreshold - 0.5) * 0.20;

  // final clamp
  score = Math.max(0, Math.min(1, score));

  // Level mapping (hart)
let level: InterventionLevel = "observe";

const allowContradict = hasContradiction || hasEscalation;

if (score >= 0.82 && allowContradict) level = "contradict";
else if (score >= 0.58) level = "recommend";
else if (score >= 0.32) level = "hint";

// falls score hoch wäre, aber contradict nicht erlaubt -> cap auf recommend
if (score >= 0.82 && !allowContradict) {
  level = "recommend";
}

  // ReasonCodes (nur Codes)
  const reasonCodes: string[] = [];
  for (const t of triggers) reasonCodes.push(`trigger:${t}`);
  if (!allowContradict && score >= 0.82) reasonCodes.push("gate:contradict_blocked");

  if (interventionDepth >= 0.7) reasonCodes.push("depth:high");
  else if (interventionDepth <= 0.3) reasonCodes.push("depth:low");

  if (directness >= 0.7) reasonCodes.push("directness:high");
  else if (directness <= 0.3) reasonCodes.push("directness:low");

  if (patience >= 0.7) reasonCodes.push("patience:high");
  else if (patience <= 0.3) reasonCodes.push("patience:low");

  if (escalationThreshold <= 0.4) reasonCodes.push("escalation:low_threshold");
  else if (escalationThreshold >= 0.8) reasonCodes.push("escalation:high_threshold");

  const debug = {
    score,
    msgPreview: msg.slice(0, 160),
    reflectionLevel,
  };

  return {
    version: 1,
    level,
    reasonCodes,
    debug,
  };
}