// functions/src/core/haltung/triggers.ts
// PHASE 3.2: deterministische Trigger-Logik (ohne KI)

export type HaltungTrigger =
  | "repeat_pattern"
  | "decision_near"
  | "contradiction"
  | "escalation_marker";

export type HaltungTriggerResult = {
  hasTrigger: boolean;
  triggers: HaltungTrigger[];
  debug?: Record<string, any>;
};

function includesAny(haystack: string, needles: string[]): boolean {
  const s = String(haystack || "").toLowerCase();
  return needles.some((n) => s.includes(n));
}

// MVP v0: deterministische Trigger nur aus aktueller Nachricht
// (Repeat/Contradiction/Eskalation machen wir in Phase 3.3/4 sauber)
export function computeHaltungTriggersFromMessage(opts: {
  message: string;
}): HaltungTriggerResult {
  const msg = String(opts.message || "").trim();

  const triggers: HaltungTrigger[] = [];

  // 1) Decision-near: Entscheidungen mit Konsequenz
  if (
    includesAny(msg, [
      "soll ich",
      "sollen wir",
      "entscheide",
      "entscheidung",
      "ich muss mich entscheiden",
      "kaufen oder",
      "verkaufen oder",
      "kündigen",
      "unterschreiben",
      "vertrag",
      "mieterhöhung",
      "mahnen",
      "anwalt",
      "gericht",
    ])
  ) {
    triggers.push("decision_near");
  }

  // 2) Escalation marker: User fordert Härte / Eskalation
  if (
    includesAny(msg, [
      "jetzt reicht's",
      "ich raste aus",
      "ich will das eskalieren",
      "mach druck",
      "sofort",
      "knallhart",
      "konfrontier",
      "drohen",
      "abmahnen",
      "rauswerfen",
    ])
  ) {
    triggers.push("escalation_marker");
  }

  // contradiction / repeat_pattern kommen später (brauchen History/Facts)
  // -> bewusst jetzt noch NICHT, um Core sauber aufzubauen.

  const uniq = Array.from(new Set(triggers));

  return {
    hasTrigger: uniq.length > 0,
    triggers: uniq,
    debug: {
      msgPreview: msg.slice(0, 160),
    },
  };
}