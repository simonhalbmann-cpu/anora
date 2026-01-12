// functions/src/core/satellites/registryBootstrap.ts
// Central place to register satellites (pure bootstrap).
// IMPORTANT: must be idempotent (may be called multiple times per process).

import {
  DOCUMENT_UNDERSTANDING_SATELLITE_ID,
  DOCUMENT_UNDERSTANDING_VERSION,
  runDocumentUnderstandingSatellite,
} from "./document-understanding";

import { registerSatellite } from "./registry";

// Module-level guard: ensures satellites are registered exactly once per process
let __BOOTSTRAPPED__ = false;

export function bootstrapSatellites(): void {
  if (__BOOTSTRAPPED__) return;
  __BOOTSTRAPPED__ = true;

  registerSatellite({
    satelliteId: DOCUMENT_UNDERSTANDING_SATELLITE_ID,
    version: DOCUMENT_UNDERSTANDING_VERSION,
    run: runDocumentUnderstandingSatellite,
  });
}