// functions/src/core/facts/types.ts
// Roadmap 3.1: Core Fact Types + Extractor Interface (domain-agnostisch)

import type { EntityDomain, EntityType } from "../entities/types";

export type FactValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | Record<string, any>;

export type FactKey = string;

export type FactSource =
  | "raw_event"
  | "legacy_ingest"
  | "manual"
  | "other";

export type ValidityWindow = {
  // optional: Facts können zeitlich gelten
  from?: number; // unix millis
  to?: number;   // unix millis
};

export type FactDoc = {
  factId: string;          // später deterministisch (3.2)
  entityId: string;

  domain: EntityDomain;
  key: FactKey;
  value: FactValue;

  // optional: Einheiten / Normalisierungshinweise
  unit?: string;

  // Provenance / Debug
  source: FactSource;
  sourceRef?: string;      // z.B. rawEventId
  confidence?: number;     // 0..1 (optional, nicht erzwingen)

  // Konflikte / Supersedes (3.4)
  conflict?: boolean;
  supersedesFactId?: string;

  validity?: ValidityWindow;

  createdAt: number;
  updatedAt: number;

  meta?: Record<string, any>;
};

export type FactInput =
  Omit<FactDoc, "createdAt" | "updatedAt" | "factId" | "entityId"> & {
    // erlaubt: Extractor liefert ohne IDs, Store ergänzt das
    factId?: string;
    entityId?: string;

    createdAt?: number;
    updatedAt?: number;

    // 3.5.1: optionaler Resolver-Input (wenn entityId fehlt)
    entityFingerprint?: string;
    entityDomain?: EntityDomain;
    entityType?: EntityType;
  };

export type ExtractorInput = {
  rawEventId: string;
  locale: string;
  sourceType: string;
  payload: Record<string, any>;
  meta: Record<string, any>;
};

export type ExtractorResult = {
  facts: FactInput[];
  warnings?: string[];
};

export type Extractor = {
  id: string;
  domain: string;
  extract(input: ExtractorInput): Promise<ExtractorResult>;
};