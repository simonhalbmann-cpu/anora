// src/core/satellites/interventionContract.ts
import { enforceCoreResponseBoundaries } from "../interventions/guard";
import type { InterventionLevel } from "../interventions/types";

/**
 * FINAL (Phase 5.2)
 * Harte Satellite-Grenzen:
 * - keine Moral
 * - kein Druck
 * - keine Abhängigkeit
 * - deterministisch
 */

export function buildInterventionDirectiveV1(level: InterventionLevel): string {
  switch (level) {
    case "observe":
      return [
        "OUTPUT-CONTRACT:",
        "- Nur neutrales Spiegeln oder Zusammenfassen.",
        "- Maximal eine kurze Klärungsfrage.",
        "- KEINE Empfehlungen, KEINE Anweisungen, KEIN Widerspruch.",
        "- Keine Moral, kein Druck, keine Abhängigkeit.",
      ].join("\n");

    case "hint":
      return [
        "OUTPUT-CONTRACT:",
        "- Genau ein Hinweis ODER eine Reflexionsfrage.",
        "- KEINE konkreten Handlungsanweisungen.",
        "- Keine Moral, kein Druck, keine Abhängigkeit.",
      ].join("\n");

    case "recommend":
      return [
        "OUTPUT-CONTRACT:",
        "- Eine konkrete Empfehlung ODER genau zwei Optionen.",
        "- Kein Druck, keine Moral, keine Abhängigkeit.",
      ].join("\n");

    case "contradict":
      return [
        "OUTPUT-CONTRACT:",
        "- Klar widersprechen.",
        "- Eine sachliche Begründung.",
        "- Optional eine Alternative.",
        "- Kein Druck, keine Moral, keine Abhängigkeit.",
      ].join("\n");
  }
}

/* ------------------ Guards ------------------ */

function looksLikeDirectAdvice(lower: string): boolean {
  return (
    /\bdu\s+(solltest|musst|müsstest|kannst|könntest)\b/.test(lower) ||
    /\bich\s+(empfehle|rate)\b/.test(lower) ||
    /\b(mach|tu|geh|nimm|vermeide|probiere)\b/.test(lower)
  );
}

function looksLikeSteps(text: string): boolean {
  return (
    /(^|\n)\s*[-*•]\s+/.test(text) ||
    /(^|\n)\s*\d+\.\s+/.test(text)
  );
}

function hasForbiddenTone(lower: string): boolean {
  return (
    /\b(schuld|unmoralisch|verwerflich|du bist dumm|du bist falsch)\b/.test(lower) ||
    /\b(musst|unbedingt|sofort|keine wahl)\b/.test(lower) ||
    /\b(nur ich|vertrau mir|du brauchst mich)\b/.test(lower)
  );
}

function hasExplicitContradiction(lower: string): boolean {
  return (
    lower.includes("das stimmt nicht") ||
    lower.includes("das ist falsch") ||
    lower.includes("ich widerspreche") ||
    lower.includes("so ist das nicht")
  );
}

export function assertSatelliteReplyMatchesInterventionV1(
  level: InterventionLevel,
  reply: string
): void {
  const r = reply.trim();
  const lower = r.toLowerCase();

  if (!r) {
    throw new Error("SATELLITE_EMPTY_REPLY");
  }

  const guard = enforceCoreResponseBoundaries(r);
  if (!guard.ok) {
    throw new Error(`SATELLITE_GUARD_VIOLATION: ${guard.violations.join(",")}`);
  }

  if (hasForbiddenTone(lower)) {
    throw new Error("SATELLITE_FORBIDDEN_TONE");
  }

  if (level === "observe") {
    if (looksLikeDirectAdvice(lower) || looksLikeSteps(r)) {
      throw new Error("OBSERVE_CONTAINS_ADVICE");
    }
    if ((r.match(/\?/g) ?? []).length > 1) {
      throw new Error("OBSERVE_TOO_MANY_QUESTIONS");
    }
  }

  if (level === "hint") {
    if (looksLikeSteps(r)) {
      throw new Error("HINT_CONTAINS_STEPS");
    }
  }

  if (level === "recommend") {
    if (!looksLikeDirectAdvice(lower) && !looksLikeSteps(r)) {
      throw new Error("RECOMMEND_WITHOUT_RECOMMENDATION");
    }
  }

  if (level === "contradict") {
    if (!hasExplicitContradiction(lower)) {
      throw new Error("CONTRADICT_WITHOUT_MARKER");
    }
  }
}