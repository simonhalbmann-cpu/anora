// functions/src/core/facts/registryBootstrap.ts
// Roadmap 3.7.x: zentraler Bootstrap, der alle Extractors registriert.
// Wird genau 1x beim Cold Start geladen (durch Import in src/index.ts).

import { listExtractors, registerExtractor } from "./registry";

// Domain Extractors
import { documentUnderstandingV1Extractor } from "../../domains/document_understanding/extractors";
import { realEstateV1Extractor } from "../../domains/real_estate/extractors";

// Optionaler Logger (nur wenn firebase-functions verfügbar ist)
let logInfo: ((msg: string, data?: any) => void) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { logger } = require("firebase-functions/logger");
  logInfo = (m: string, d?: any) => logger.info(m, d);
} catch {
  logInfo = null;
}

export function bootstrapExtractors(): void {
  registerExtractor(realEstateV1Extractor);
  registerExtractor(documentUnderstandingV1Extractor);

  // Logging nur, wenn verfügbar
  logInfo?.("extractor_registry_bootstrap", {
    registered: listExtractors(),
  });
}

// Direkt beim Import ausführen
bootstrapExtractors();