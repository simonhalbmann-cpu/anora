// functions/src/core/entities/types.ts
// Roadmap 3.1: Core Entity Types (domain-agnostisch)

export type EntityDomain = "real_estate" | "generic";

export function toEntityDomain(input: unknown): EntityDomain {
  if (input === "real_estate") return "real_estate";
  return "generic";
}

export type EntityType =
  | "property"
  | "tenant"
  | "person"
  | "contract"
  | "event"
  | "document"
  | "generic";

export type EntityRef = {
  entityId: string; // Core-ID (stabil, später Strategie v1)
  domain?: EntityDomain;
  type?: EntityType;
};

export type EntityDoc = {
  entityId: string;
  domain: EntityDomain;
  type: EntityType;

  // optional: Kurzlabel für UI/Debug
  label?: string;

  // optional: für späteres Mapping/Fingerprints (noch keine Logik)
  fingerprints?: string[];

  createdAt: number;
  updatedAt: number;

  // flexibles Meta (klein halten)
  meta?: Record<string, any>;
};

export function toEntityType(input: any): EntityType {
  const v = String(input ?? "").trim();
  const allowed: EntityType[] = [
    "property",
    "tenant",
    "person",
    "contract",
    "event",
    "document",
    "generic",
  ];
  return (allowed as string[]).includes(v) ? (v as EntityType) : "generic";
}