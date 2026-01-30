// functions/src/core/meta/dailyDigestAggregate.ts
// Phase 5.2: Daily Digest Aggregation (PURE, DATA ONLY)
// - No writes, no side effects
// - Deterministic + bounded
// - Aggregates digest_only contributions per dayBucket
export type DailyDigestAggregateV1 = {
  version: 1;
  dayBucket: string; // e.g. "1970-01-01" in your deterministic mode
  contributionsCount: number;

  counts: {
    processedLocal: number;
    blockedByTier: number;
    errors: number;
  };

  docTypes: Record<string, number>; // merged counts
  reasonCodes: string[];            // unique + sorted + bounded
};

/**
 * Aggregate multiple contributions into one daily object.
 * Deterministic:
 * - reasonCodes: unique + sorted
 * - docTypes keys: stable order (by insertion, but we also normalize at the end)
 */





