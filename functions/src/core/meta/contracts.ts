// functions/src/core/meta/contracts.ts

export type PresenceType = "project_nudging" | "decision_followup" | "stress_hint" | "generic";

export type DailyDigestDoc = {
  message: string;
  createdAt: number;
  source?: string;
  status?: string;
};

export type PresenceActiveDoc = {
  type: PresenceType;
  message: string;
  createdAt: number;
  source?: string;
  status?: string;
};

export type PresenceSettingsDoc = {
  enabled: boolean;
  updatedAt?: number;
};

export type PresenceTopicsDoc = {
  topics: Record<string, { lastDisabledAt: number }>;
  updatedAt?: number;
};

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: any, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function parseDailyDigestDoc(d: any): DailyDigestDoc | null {
  if (!d || typeof d !== "object") return null;

  const message = asString(d.message || d.text).trim();
  const createdAt = asNumber(d.createdAt, 0);

  if (!message) return null;
  if (createdAt <= 0) return null;

  const source = asString(d.source).trim() || undefined;
  const status = asString(d.status).trim() || undefined;

  return { message, createdAt, source, status };
}

export function parsePresenceActiveDoc(d: any): PresenceActiveDoc | null {
  if (!d || typeof d !== "object") return null;

  const typeRaw = asString(d.type).trim();
  const type: PresenceType =
    typeRaw === "project_nudging" ||
    typeRaw === "decision_followup" ||
    typeRaw === "stress_hint" ||
    typeRaw === "generic"
      ? (typeRaw as PresenceType)
      : "generic";

  const message = asString(d.message).trim();
  const createdAt = asNumber(d.createdAt, 0);

  if (!message) return null;
  if (createdAt <= 0) return null;

  const source = asString(d.source).trim() || undefined;
  const status = asString(d.status).trim() || undefined;

  return { type, message, createdAt, source, status };
}

export function parsePresenceSettingsDoc(d: any): PresenceSettingsDoc {
  const enabled = d?.enabled === true;
  const updatedAt = typeof d?.updatedAt === "number" ? d.updatedAt : undefined;
  return { enabled, updatedAt };
}

export function parsePresenceTopicsDoc(d: any): PresenceTopicsDoc {
  const rawTopics = d?.topics && typeof d.topics === "object" ? d.topics : {};
  const topics: Record<string, { lastDisabledAt: number }> = {};

  for (const k of Object.keys(rawTopics)) {
    const row = rawTopics[k];
    const lastDisabledAt =
      row && typeof row === "object" && typeof row.lastDisabledAt === "number" && Number.isFinite(row.lastDisabledAt)
        ? row.lastDisabledAt
        : 0;
    topics[k] = { lastDisabledAt };
  }

  const updatedAt = typeof d?.updatedAt === "number" ? d.updatedAt : undefined;
  return { topics, updatedAt };
}