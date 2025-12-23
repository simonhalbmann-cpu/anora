// -----------------------------------------------------------------------------
// PURE CORE BRIDGE
//
// GUARANTEES:
// - NO Firestore
// - NO OpenAI
// - NO firebase-functions
// - NO environment access
// - NO side effects
//
// This file is the ONLY allowed entry point for:
// - runCoreOnce (pure)
// - runCoreWithPersistence (pure wrapper)
//
// Used by:
// - tests
// - stability checks
// - future offline simulations
//
// DO NOT import from ./bridge.ts here.
// -----------------------------------------------------------------------------

export { runCoreOnce } from "./runCoreOnce";
export type { RunCoreOnceInput, RunCoreOnceOutput } from "./runCoreOnce";

export { runCoreWithPersistence } from "./runCoreWithPersistence";
export type {
    RunCoreWithPersistenceInput,
    RunCoreWithPersistenceOutput
} from "./runCoreWithPersistence";

