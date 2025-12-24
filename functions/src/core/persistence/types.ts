// functions/src/core/persistence/types.ts

export type CoreWritePlanV1 = {
  version: 1;

  rawEvent: "none" | "append";

  facts: {
    mode: "none" | "upsert";
    count: number;
  };

  haltung: {
    mode: "none" | "patch";
    keys: string[];
  };
};

export type PersistenceStatusV1 =
  | { dryRun: true; wrote: false; reason: "dry_run" }
  | { dryRun: false; wrote: false; reason: "noop" }
  | { dryRun: false; wrote: true; reason: "executed"; counts: { rawEventsAppended: number; factsUpserted: number; haltungPatched: number } }
  | { dryRun: false; wrote: false; reason: "failed"; error: { message: string } };

export type PersistenceResultV1 =
  | { wrote: true; reason: "executed"; counts: { rawEventsAppended: number; factsUpserted: number; haltungPatched: number } }
  | { wrote: false; reason: "noop"; counts: { rawEventsAppended: 0; factsUpserted: 0; haltungPatched: 0 } }
  | { wrote: false; reason: "failed"; error: { message: string } };