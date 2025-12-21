// functions/src/core/facts/registryBootstrap.ts
// Roadmap 3.7.x: zentraler Bootstrap, der alle Extractors registriert.
// Wird genau 1x beim Cold Start geladen (durch Import in src/index.ts).

import { logger } from "firebase-functions/logger";
import { listExtractors, registerExtractor } from "./registry";

// Domain Extractors
import { realEstateV1Extractor } from "../../domains/real_estate/extractors";

export function bootstrapExtractors(): void {
  // Hier alle Extractors registrieren
  registerExtractor(realEstateV1Extractor);

  logger.info("extractor_registry_bootstrap", {
    registered: listExtractors(),
  });
}

// Direkt beim Import ausführen (damit index.ts nur importieren muss)
bootstrapExtractors();