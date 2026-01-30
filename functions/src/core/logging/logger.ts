// functions/src/core/logging/logger.ts
import * as logger from "firebase-functions/logger";

/**
 * Zentraler Logger für den Core.
 * Vorteil: nur hier hängt firebase-functions/logger dran.
 */
export { logger };
