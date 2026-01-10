// functions/src/core/satellites/registryBootstrap.ts
// Central place to register satellites (pure bootstrap).

import {
  DOCUMENT_UNDERSTANDING_SATELLITE_ID,
  DOCUMENT_UNDERSTANDING_VERSION,
  runDocumentUnderstandingSatellite,
} from "./document-understanding";
import { registerSatellite } from "./registry";

export function bootstrapSatellites(): void {
  registerSatellite({
    satelliteId: DOCUMENT_UNDERSTANDING_SATELLITE_ID,
    version: DOCUMENT_UNDERSTANDING_VERSION,
    run: runDocumentUnderstandingSatellite,
  });
}