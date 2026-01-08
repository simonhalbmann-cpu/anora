// functions/src/domains/real_estate/adapter.ts
// Roadmap 4.3: Domain Adapter (real_estate) – Core facts_v1 -> Legacy Knowledge (BrainFactDoc)

import type { FactDoc } from "../../core/facts/types";

// Wir tippen hier bewusst minimal, damit wir nichts zirkulär importieren.
// BrainFactDoc Shape entspricht dem, was runServerBrain erwartet.
export type BrainFactDoc = {
  type: string;
  tags?: string[];
  data?: any;
  raw?: string;
  createdAt: number;
  userId: string;
};

export function mapRealEstateFactsToLegacyKnowledge(opts: {
  userId: string;
  facts: FactDoc[];
}): BrainFactDoc[] {
  const { userId, facts } = opts;

  // PHASE 2: Adapter darf NICHT priorisieren, NICHT aggregieren, NICHT interpretieren.
  // Er macht nur ein 1:1 Mapping: 1 Core-Fact => 1 Legacy-BrainFactDoc.
  // Reihenfolge deterministisch: nach factId (falls vorhanden), sonst stabil.
  const sorted = [...facts].sort((a: any, b: any) =>
    String(a?.factId ?? "").localeCompare(String(b?.factId ?? ""))
  );

  return sorted.map((f: any) => ({
    type: "core_fact_v1",
    tags: ["core", "facts_v1", `domain:${String(f?.domain ?? "")}`, `key:${String(f?.key ?? "")}`],
    data: {
      domain: f?.domain ?? null,
      key: f?.key ?? null,
      value: typeof f?.value === "undefined" ? null : f.value,

      entityId: f?.entityId ?? null,
      factId: f?.factId ?? null,

      source: f?.source ?? null,
      sourceRef: f?.sourceRef ?? null,

      conflict: f?.conflict === true,

      createdAt: f?.createdAt ?? null,
      updatedAt: f?.updatedAt ?? null,

      meta: f?.meta ?? null,
    },
    raw: "",
    createdAt: typeof f?.createdAt === "number" ? f.createdAt : Date.now(),
    userId,
  }));
}