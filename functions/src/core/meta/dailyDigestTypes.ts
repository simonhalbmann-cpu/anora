// functions/src/core/meta/dailyDigestTypes.ts
// Phase 5.1/5.2: Daily Digest Plan (DATA ONLY)
// PURE: no writes, no side effects, deterministic, bounded.

// Minimal Tier-Type (entkoppelt von Satellites)
export type UserTier = "free" | "pro";

// Minimal Insight-Type (entkoppelt von Satellites)
export type DigestInsight = {
  code: string;
  data?: any;
};

export type DailyDigestContributionV1 = {
  version: 1;
  extractorId: "document_understanding.v1";
  tier: UserTier;

  counts: {
    processedLocal: number;
    blockedByTier: number;
    errors: number;
  };

  docTypes: Record<string, number>;
  reasonCodes?: string[];
};

function toSafeString(x: any, fallback: string): string {
  return typeof x === "string" && x.trim() ? x.trim() : fallback;
}

function clampInt(n: any, fallback = 0): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(0, x);
}

function getInsight(insights: DigestInsight[], code: string): DigestInsight | null {
  const arr = Array.isArray(insights) ? insights : [];
  return (arr.find((i) => i?.code === code) as any) ?? null;
}

/**
 * Build ONE digest contribution for ONE document run.
 * Later Phase 5.2 aggregates these per day.
 */
export function buildDailyDigestContributionV1(input: {
  tier: UserTier;
  insights: DigestInsight[];
}): DailyDigestContributionV1 {
  const tier: UserTier = input.tier === "pro" ? "pro" : "free";
  const insights = Array.isArray(input.insights) ? input.insights : [];

  const struct = getInsight(insights, "doc_structure_detected");
  const hasText = !!(struct?.data as any)?.hasText;

  const dt = getInsight(insights, "doc_type_detected");
  const docType = toSafeString((dt?.data as any)?.docType, "unknown");

  const gate = getInsight(insights, "digest_plan_gate");
  const allowed = (gate?.data as any)?.allowed === true;

  const processedLocal = hasText ? 1 : 0;
  const blockedByTier = allowed ? 0 : 1;

  const docTypes: Record<string, number> = {};
  docTypes[docType] = 1;

  const reasonCodes: string[] = [];
  const reasonCode = toSafeString((gate?.data as any)?.reasonCode, "");
  if (reasonCode) reasonCodes.push(reasonCode);

  return {
    version: 1,
    extractorId: "document_understanding.v1",
    tier,
    counts: {
      processedLocal: clampInt(processedLocal),
      blockedByTier: clampInt(blockedByTier),
      errors: 0,
    },
    docTypes,
    reasonCodes: reasonCodes.slice(0, 6),
  };
}