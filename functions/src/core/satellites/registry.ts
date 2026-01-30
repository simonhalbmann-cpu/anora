// functions/src/core/satellites/registry.ts
// Core Satellite Registry (pure)

import type { SatelliteInput, SatelliteOutput } from "./satelliteContract";

/**
 * Ein Satellite ist eine andockbare Analyse-Funktion.
 * WICHTIG:
 * - Registry ist PURE: keine firebase imports, keine side effects.
 * - Satelliten dÃ¼rfen selbst auch pure sein (oder impure Ã¼ber injected deps),
 *   aber die Registry selbst macht nichts auÃŸer speichern/auflisten.
 */

export type SatelliteRunFn = (
  input: SatelliteInput,
  deps?: any
) => Promise<SatelliteOutput> | SatelliteOutput;

export type SatelliteDefinition = {
  satelliteId: string;
  version: string;     // z.B. "1.0.0" oder "2026-01-09"
  run: SatelliteRunFn;
};
/**
 * Nur fÃ¼r Tests/Skripte, niemals im Produktivpfad benutzen.
 */







