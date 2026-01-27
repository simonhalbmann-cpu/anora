// src/services/presenceTopicsApi.ts

import { postJsonAuthed } from "./anoraAdmin";

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
export async function apiGetPresenceTopics(): Promise<PresenceTopicsResponse> {
  const json = (await postJsonAuthed("anoraPresenceTopics", {})) as PresenceTopicsResponse;
  return json;
}

// Einzelnes Topic muten / entmuten
export async function apiSetPresenceTopicMuted(
  topic: PresenceTopicKey,
  muted: boolean
): Promise<PresenceTopicsResponse> {
  const json = (await postJsonAuthed("anoraPresenceTopics", { topic, muted })) as PresenceTopicsResponse;
  return json;
}