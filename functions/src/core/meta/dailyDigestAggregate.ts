// functions/src/core/meta/dailyDigestAggregate.ts
// Phase 5.2: Daily Digest Aggregation (PURE, DATA ONLY)
// - No writes, no side effects
// - Deterministic + bounded
// - Aggregates digest_only contributions per dayBucket

import type { DailyDigestContributionV1 } from "./dailyDigestTypes";

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

function toSafeString(x: any, fallback: string): string {
  return typeof x === "string" && x.trim() ? x.trim() : fallback;
}

function clampInt(n: any, fallback = 0): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(0, x);
}

function inc(map: Record<string, number>, key: string, by: number) {
  const k = toSafeString(key, "unknown");
  const v = clampInt(by, 0);
  map[k] = clampInt((map[k] ?? 0) + v, 0);
}

/**
 * Aggregate multiple contributions into one daily object.
 * Deterministic:
 * - reasonCodes: unique + sorted
 * - docTypes keys: stable order (by insertion, but we also normalize at the end)
 */
export function aggregateDailyDigestV1(input: {
  dayBucket: string;
  contributions: DailyDigestContributionV1[];
}): DailyDigestAggregateV1 {
  const dayBucket = toSafeString(input.dayBucket, "unknown_day");
  const contributions = Array.isArray(input.contributions) ? input.contributions : [];

  const counts = { processedLocal: 0, blockedByTier: 0, errors: 0 };
  const docTypes: Record<string, number> = {};
  const reasonSet = new Set<string>();

  for (const c of contributions) {
    if (!c || (c as any).version !== 1) continue;

    counts.processedLocal += clampInt((c as any)?.counts?.processedLocal, 0);
    counts.blockedByTier += clampInt((c as any)?.counts?.blockedByTier, 0);
    counts.errors += clampInt((c as any)?.counts?.errors, 0);

    const dt = (c as any)?.docTypes && typeof (c as any).docTypes === "object" ? (c as any).docTypes : {};
    for (const k of Object.keys(dt)) {
      inc(docTypes, k, dt[k]);
    }

    const rc = Array.isArray((c as any)?.reasonCodes) ? (c as any).reasonCodes : [];
    for (const r of rc) {
      const s = toSafeString(r, "");
      if (s) reasonSet.add(s);
    }
  }

  // deterministisch: reasonCodes sortiert + bounded
  const reasonCodes = Array.from(reasonSet).sort((a, b) => a.localeCompare(b)).slice(0, 12);

  // deterministisch: docTypes keys sortiert (damit JSON stabil bleibt)
  const docTypesSorted: Record<string, number> = {};
  Object.keys(docTypes)
    .sort((a, b) => a.localeCompare(b))
    .forEach((k) => {
      docTypesSorted[k] = clampInt(docTypes[k], 0);
    });

  return {
    version: 1,
    dayBucket,
    contributionsCount: contributions.length,
    counts: {
      processedLocal: clampInt(counts.processedLocal),
      blockedByTier: clampInt(counts.blockedByTier),
      errors: clampInt(counts.errors),
    },
    docTypes: docTypesSorted,
    reasonCodes,
  };
}