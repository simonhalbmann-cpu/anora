// functions/src/core/CORE_FREEZE.ts
// Phase 0.2 — Index Freeze (minimal)

export const FROZEN = {
  factKeys: ["city", "rent_cold", "doc:summary"] as const,
  domains: ["real_estate", "generic"] as const,

  // ✅ NEU: nur das, was aktuell existiert (Index-Freeze)
  extractors: ["real_estate.v1"] as const,
} as const;

export type FrozenFactKey = (typeof FROZEN.factKeys)[number];
export type FrozenDomain = (typeof FROZEN.domains)[number];