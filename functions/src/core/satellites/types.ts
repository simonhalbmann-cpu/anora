/**
 * Satellite Types (Phase 5.x)
 * Ziel: index.ts entlasten und Typen wiederverwendbar machen.
 */

// Welche Fact-Typen es grundsätzlich gibt
export type BrainFactType =
  // Domains / Entities
  | "property"
  | "tenant"
  | "event"
  | "person"
  | "generic"
  // Core / facts_v1 keys (damit wir nicht wieder auf "string" zurückfallen)
  | "city"
  | "rent_cold"
  | "summary";

// ------------------------------
// Chat
// ------------------------------
export type BrainChatMessage = {
  role: "user" | "assistant" | "anora";
  text: string;
};

// ------------------------------
// Facts (flexibel, aber stabil)
// ------------------------------
export type AnyFactData = Record<string, any>;

export type BrainFactDoc = {
  type: BrainFactType;
  tags?: string[];
  data?: AnyFactData;
  raw?: string;
  createdAt: number;
  userId: string;
};

export type BrainFactInput = {
  type: BrainFactType;
  tags?: string[];
  data?: AnyFactData;
  raw?: string;
};

// ------------------------------
// Contexts
// ------------------------------
export type BrainContexts = {
  tenant?: Record<string, any> | null;
  property?: Record<string, any> | null;
  city?: Record<string, any> | null;
  userProfile?: Record<string, any> | null;
  focus?: Record<string, any> | null;
};

// ------------------------------
// Actions / Tasks
// ------------------------------
export type BrainAction =
  | { type: "reset_context"; context: "tenant" | "property" | "city"; reason?: string }
  | { type: "set_context"; context: "tenant" | "property" | "city"; value: Record<string, any>; reason?: string };

export type BrainTask = {
  type: "clarify_context" | "manual_risk_check" | "watch_location" | "todo";
  payload?: Record<string, any>;
};

// ------------------------------
// IO
// ------------------------------
export type BrainInput = {
  userId: string;
  userName?: string | null;     // <- WICHTIG: darf undefined sein
  message: string;
  history: BrainChatMessage[];
  knowledge: BrainFactDoc[];
  contexts?: BrainContexts;      // <- WICHTIG: darf undefined sein
};

export type BrainOutput = {
  reply: string;
  newFacts: BrainFactInput[];
  actions: BrainAction[];
  tasks: BrainTask[];
};