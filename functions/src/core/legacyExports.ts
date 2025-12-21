// functions/src/core/legacyExports.ts
// Übergangsmodul: Dinge, die bisher im God-File leben.
// Ziel: Bridge darf NIEMALS ../index importieren (Zirkular-Import).

export { safeParseAssistantJson } from "./parsing/safeParseAssistantJson";

export { saveNewFacts } from "./persistence/saveNewFacts";
export type { BrainFactInput } from "./persistence/saveNewFacts";

export {
  setMietrechtContextForUser,
  updateMietrechtContextFromFacts
} from "./context/mietrechtContext";
export type { MietrechtContext } from "./context/mietrechtContext";
