// functions/src/core/persistence/types.ts

export type CoreWritePlanV1 = {
  rawEvent: "none"; // Phase 6.3+: ggf. "create"
  facts: "none" | "upsert";
  haltung: "none" | "patch";
};

export type PersistenceStatusV1 =
  | { dryRun: true; wrote: false; reason: "dry_run" }
  | { dryRun: false; wrote: false; reason: "not_implemented_yet" };