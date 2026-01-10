// functions/src/core/persistence/types.ts

export type PersistenceCountsV1 = {
  rawEventsAppended: number;
  factsUpserted: number;
  haltungPatched: number;

  // A4.5
  historyAppended: number;
  evidenceAppended: number;
};

export type CoreWritePlanV1 = {
  version: 1;

  rawEvent: "none" | "append";

  facts: {
    mode: "none" | "upsert";
    count: number;
  };

  haltung: {
  mode: "none" | "set_state";
  keys: string[]; // optional: welche Felder sich geändert haben
};
};

export type PersistenceStatusV1 =
  | { dryRun: true; wrote: false; reason: "dry_run" }
  | { dryRun: false; wrote: false; reason: "noop"; counts: PersistenceCountsV1 }
  | {
      dryRun: false;
      wrote: true;
      reason: "executed";
      counts: PersistenceCountsV1;
    }
  | { dryRun: false; wrote: false; reason: "failed"; error: { message: string } };

export type PersistenceResultV1 =
  | { wrote: true; reason: "executed"; counts: PersistenceCountsV1 }
  | {
      wrote: false;
      reason: "noop";
      counts: PersistenceCountsV1;
    }
  | { wrote: false; reason: "failed"; error: { message: string } };