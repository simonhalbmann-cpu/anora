// src/services/presenceTopicsApi.ts

const FUNCTIONS_BASE_URL =
  "http://192.168.178.141:5001/anoraapp-ai/us-central1";

export type PresenceTopicKey =
  | "stress_cluster"
  | "money_decision"
  | "project_followup"
  | "location_watch"
  | "other";

export type PresenceTopicState = {
  blockedUntil?: number;
  lastDisabledAt?: number;
};

export type PresenceTopicsMap = Partial<
  Record<PresenceTopicKey, PresenceTopicState>
>;

type PresenceTopicsResponse = {
  ok: boolean;
  userId?: string;
  topics: PresenceTopicsMap;
};

// Alle Topic-States lesen
export async function apiGetPresenceTopics(
  userId: string
): Promise<PresenceTopicsResponse> {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/anoraPresenceTopics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log("apiGetPresenceTopics HTTP error", res.status, text);
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as PresenceTopicsResponse;
  return json;
}

// Einzelnes Topic muten / entmuten
export async function apiSetPresenceTopicMuted(
  userId: string,
  topic: PresenceTopicKey,
  muted: boolean
): Promise<PresenceTopicsResponse> {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/anoraPresenceTopics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, topic, muted }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log(
      "apiSetPresenceTopicMuted HTTP error",
      res.status,
      text
    );
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as PresenceTopicsResponse;
  return json;
}