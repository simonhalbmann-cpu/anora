// functions/src/domains/real_estate/utils/propertySummary.ts

import type { FactDoc } from "../../../core/facts/types";

export function buildPropertySummaryValueV1(facts: FactDoc[]): Record<string, any> {
  // Wir nehmen die "letzten" Facts pro Key (facts sind später ohnehin desc sortiert)
  const byKey = new Map<string, FactDoc>();

  for (const f of facts) {
    if (!f?.key) continue;

    // Optional: wenn conflict=true, eher hinten anstellen
    // -> wir preferieren non-conflict, aber wenn es nur conflict gibt, nehmen wir es.
    const existing = byKey.get(f.key);
    if (!existing) {
      byKey.set(f.key, f);
      continue;
    }

    const existingConflict = existing.conflict === true;
    const currentConflict = f.conflict === true;

    // prefer non-conflict
    if (existingConflict && !currentConflict) {
      byKey.set(f.key, f);
      continue;
    }

    // ansonsten: updatedAt gewinnt
    if ((f.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      byKey.set(f.key, f);
    }
  }

  const city = byKey.get("city")?.value ?? null;
  const rentCold = byKey.get("rent_cold")?.value ?? null;
  const rentWarm = byKey.get("rent_warm")?.value ?? null;

  return {
    city,
    rent_cold: rentCold,
    rent_warm: rentWarm,
    updatedFromFactsAt: Date.now(),
  };
}