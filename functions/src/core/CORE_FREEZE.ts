// functions/src/core/CORE_FREEZE.ts
// Phase 0.2 — Index Freeze (minimal)

export const FROZEN = {
  factKeys: [
  "city",
  "rent_cold",
  "rent_nk",
  "units_count",
  "units_total",          
  "shop_rent_cold",
  "shop_rent_nk",
  "doc:summary",
] as const,
  domains: ["real_estate", "generic"] as const,
  extractors: ["real_estate.v1"] as const,
} as const;

export type FrozenFactKey = (typeof FROZEN.factKeys)[number];
export type FrozenDomain = (typeof FROZEN.domains)[number];