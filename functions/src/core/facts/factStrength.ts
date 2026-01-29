// --------------------------------------------------
// Fakt-Stärke – Eingabemodell (noch KEINE Logik)
// --------------------------------------------------

export type FactStrengthInputV1 = {
  // 1) Woher kommt der Fakt?
  sourceType:
    | "user_input"
    | "contract"
    | "official_document"
    | "email"
    | "expose"
    | "derived"
    | "other";

  // 2) Wie zuverlässig ist die Quelle grundsätzlich? (0..1)
  sourceReliability: number;

  // 3) Wie sicher ist der Extraktor selbst? (0..1)
  confidence: number;

  // 4) Zeitliche Einordnung
  temporal:
    | "current"
    | "amended"        // Nachtrag / Ergänzung
    | "historical"
    | "unknown";

  // 5) Hat der User den Fakt explizit bestätigt?
  userConfirmed: boolean;

  // 6) Ist es ein System-Fakt (z.B. abgeleitet)?
  system: boolean;

  // 7) Ist dieser Fakt als „neuester Stand“ markiert?
  latest: boolean;

};

// --------------------------------------------------
// Fakt-Stärke – Berechnung (deterministisch)
// --------------------------------------------------

export function computeFactStrength(
  input: FactStrengthInputV1
): number {
  let score = 0;

  // Achse 1: Quellen-Zuverlässigkeit (0..1)
  score += clamp01(input.sourceReliability) * 0.25;

  // Achse 2: Extraktor-/Inhalts-Sicherheit (0..1)
  score += clamp01(input.confidence) * 0.25;

  // Achse 3: Zeitliche Relevanz
  score += temporalScore(input.temporal) * 0.15;

  // Achse 4: User-Bestätigung
  if (input.userConfirmed) score += 0.15;

  // Achse 5: System-Fakt
  if (input.system) score += 0.05;

  // Achse 6: Latest-Flag
  if (input.latest) score += 0.15;

  return clamp01(score) * 100;
}

// --------------------------------------------------
// Hilfsfunktionen (lokal, bewusst simpel)
// --------------------------------------------------

function temporalScore(
  temporal: FactStrengthInputV1["temporal"]
): number {
  switch (temporal) {
    case "current":
      return 1.0;
    case "amended":
      return 0.9;
    case "historical":
      return 0.4;
    default:
      return 0.5;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}