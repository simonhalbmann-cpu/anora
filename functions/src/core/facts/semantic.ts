import { logger } from "firebase-functions/v2";
import type { EntityDomain } from "../entities/types";
import type { FactKey } from "./types";

const REAL_ESTATE_KEY_MAP: Record<string, FactKey> = {
  // Kaltmiete
  kaltmiete: "rent_cold",
  cold_rent: "rent_cold",
  nettomiete: "rent_cold",
  miete_kalt: "rent_cold",

  // Warmmiete
  warmmiete: "rent_warm",
  bruttomiete: "rent_warm",

  // Stadt
  stadt: "city",
  ort: "city",
};

function isSystemKey(raw: string, meta?: Record<string, any>): boolean {
  if (meta?.system === true) return true;
  // harte Regel: alles mit ":" ist System-Key (z.B. doc:summary, tenant:name, etc.)
  if (raw.includes(":")) return true;
  return false;
}

export function normalizeFactKey(
  rawKey: string,
  domain?: EntityDomain,
  meta?: Record<string, any>
): FactKey {
  const raw = String(rawKey ?? "").trim();
  if (!raw) return "";

  logger.info("normalizeFactKey_called", {
    rawKey: raw,
    domain: domain ?? null,
    hasColon: raw.includes(":"),
    metaSystem: meta?.system === true,
  });

  // 🔒 System-Facts niemals normalisieren (aber stabilisieren: trim + lowercase)
  if (isSystemKey(raw, meta)) {
    const sys = raw.toLowerCase();
    logger.info("normalizeFactKey_system_passthrough", {
      raw,
      normalized: sys,
      domain: domain ?? null,
    });
    return sys;
  }

  // Normale Keys: hart normalisieren
  const k = raw
    .toLowerCase()
    .replace(/[:\/\.\-\s]+/g, "_") // Trenner -> _
    .replace(/[^a-z0-9_]/g, "")   // Rest raus
    .replace(/_+/g, "_")          // __ -> _
    .replace(/^_+|_+$/g, "");     // leading/trailing _ weg

  logger.info("normalizeFactKey_result", {
    raw,
    normalized: k,
    domain: domain ?? null,
  });

  if (!k) return "";

  if (domain === "real_estate") {
    return REAL_ESTATE_KEY_MAP[k] ?? k;
  }

  return k;
}