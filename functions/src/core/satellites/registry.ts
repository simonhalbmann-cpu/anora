// functions/src/core/satellites/registry.ts
// Core Satellite Registry (pure)

import type { SatelliteInput, SatelliteOutput } from "./satelliteContract";

/**
 * Ein Satellite ist eine andockbare Analyse-Funktion.
 * WICHTIG:
 * - Registry ist PURE: keine firebase imports, keine side effects.
 * - Satelliten dürfen selbst auch pure sein (oder impure über injected deps),
 *   aber die Registry selbst macht nichts außer speichern/auflisten.
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

const REGISTRY = new Map<string, SatelliteDefinition>();

function normalizeId(id: string): string {
  return String(id || "").trim();
}

export function registerSatellite(def: SatelliteDefinition): void {
  const id = normalizeId(def?.satelliteId);
  if (!id) throw new Error("SATELLITE_REGISTRY: missing satelliteId");
  if (!def?.run) throw new Error(`SATELLITE_REGISTRY: missing run() for ${id}`);

  if (REGISTRY.has(id)) {
    // hart, damit wir nicht versehentlich doppelt registrieren
    throw new Error(`SATELLITE_REGISTRY: duplicate satelliteId '${id}'`);
  }

  REGISTRY.set(id, def);
}

export function getSatellite(satelliteId: string): SatelliteDefinition | null {
  const id = normalizeId(satelliteId);
  return REGISTRY.get(id) ?? null;
}

export function listSatellites(): SatelliteDefinition[] {
  return Array.from(REGISTRY.values()).sort((a, b) =>
    a.satelliteId.localeCompare(b.satelliteId)
  );
}

/**
 * Nur für Tests/Skripte, niemals im Produktivpfad benutzen.
 */
export function __resetSatellitesForTests(): void {
  REGISTRY.clear();
}