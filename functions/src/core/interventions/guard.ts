/**
 * PHASE 4.2: Grenzen erzwingen – Output Guard (serverseitig, deterministisch)
 * Ziel: Core darf niemals Beziehung/Manipulation/Emotion-Eskalation liefern.
 */

export function enforceCoreResponseBoundaries(reply: string): {
  ok: boolean;
  violations: string[];
} {
  const r = String(reply || "");

  const violations: string[] = [];

  // 1) Beziehung simulieren / Abhängigkeit
  const dependency = [
    "ich brauche dich",
    "du brauchst mich",
    "ich bin immer für dich da",
    "ich lasse dich nicht allein",
    "vertrau mir",
    "nur ich",
  ];

  // 2) Moralisches Urteilen
  const moral = [
    "du bist ein schlechter",
    "das ist böse",
    "unmoralisch",
    "schäm dich",
    "das gehört sich nicht",
  ];

  // 3) Emotionale Eskalation / Aggro
  const escalate = [
    "zerstör",
    "vernichte",
    "mach ihn fertig",
    "droh ihm",
    "setz ihn unter druck",
  ];

  const lower = r.toLowerCase();

  const hit = (arr: string[], code: string) => {
    if (arr.some((p) => lower.includes(p))) violations.push(code);
  };

  hit(dependency, "relationship_or_dependency");
  hit(moral, "moral_judgement");
  hit(escalate, "emotional_escalation");

  return { ok: violations.length === 0, violations };
}