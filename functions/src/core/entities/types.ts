// functions/src/core/entities/types.ts
// Roadmap 3.1: Core Entity Types (domain-agnostisch)

import { FROZEN } from "../CORE_FREEZE";

export type EntityDomain = "real_estate" | "generic";

export function toEntityDomain(input: unknown): EntityDomain {
  const raw = String(input ?? "").trim();

  // harte Regel: nur Domains aus CORE_FREEZE erlauben
  const allowed = FROZEN.domains as readonly string[];

  if (!allowed.includes(raw)) {
    throw new Error(
      `CORE FREEZE VIOLATION: domain '${raw}' not allowed. Allowed: ${allowed.join(", ")}`
    );
  }

  return raw as EntityDomain;
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