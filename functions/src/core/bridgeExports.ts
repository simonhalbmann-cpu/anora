// functions/src/core/bridgeExports.ts
// Bridge-sichere Sammel-Exports (impure-kompatibel), um Zirkular-Imports zu vermeiden.

export { safeParseAssistantJson } from "./parsing/safeParseAssistantJson";

export { saveNewFacts } from "./persistence/saveNewFacts";
export type { BrainFactInput } from "./persistence/saveNewFacts";

export {
  setMietrechtContextForUser,
  updateMietrechtContextFromFacts
} from "./context/mietrechtContext";
export type { MietrechtContext } from "./context/mietrechtContext";

