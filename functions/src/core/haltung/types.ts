// functions/src/core/haltung/types.ts
// PHASE 3.1: Adaptive Core-Haltung – types (nur numerisch, versioniert)

export type CoreHaltungV1 = {
  version: 1;

  // Erlaubte adaptive Dimensionen (0..1)
  directness: number;           // vorsichtig -> konfrontativ
  interventionDepth: number;    // beobachten -> widerspruch
  patience: number;             // toleriert länger -> greift schneller ein
  escalationThreshold: number;  // hoch -> selten eskalieren, niedrig -> schneller eskalieren
  reflectionLevel: number;      // kurz -> tief erklärend

  // Meta / Observability
  updatedAt: number;
};

export function defaultCoreHaltungV1(): CoreHaltungV1 {
  return {
    version: 1,
    directness: 0.5,
    interventionDepth: 0.5,
    patience: 0.5,
    escalationThreshold: 0.7, // eher konservativ starten
    reflectionLevel: 0.5,
    updatedAt: Date.now(),
  };
}