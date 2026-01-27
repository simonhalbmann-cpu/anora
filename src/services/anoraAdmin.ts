// src/services/anoraAdmin.ts

import { auth } from "./firebase";

export const FUNCTIONS_BASE_URL =
  "http://192.168.178.141:5001/anoraapp-ai/us-central1/api";


// Für Emulator (falls nötig):
// const FUNCTIONS_BASE_URL = "http://127.0.0.1:5001/<project-id>/<region>";

export async function postJsonAuthed(path: string, body: any) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not authenticated: no current user");
  }

  const idToken = await user.getIdToken();

  const res = await fetch(`${FUNCTIONS_BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Request failed: ${res.status} ${res.statusText} – ${text || "no body"}`
    );
  }

  // 204 kann bei manchen Endpoints vorkommen
  if (res.status === 204) return { ok: true };

  return res.json();
}

// --------------------------------------------------------
// 1) Wissen komplett löschen (Panic Reset)
// --------------------------------------------------------
export async function apiResetUserKnowledge(userId: string) {
  if (!userId) throw new Error("apiResetUserKnowledge: missing userId");
  return postJsonAuthed("resetUserKnowledge", { userId });
}

// --------------------------------------------------------
// 2) Persönlichkeit zurücksetzen
// --------------------------------------------------------
export async function apiResetUserPersonality(userId: string) {
  if (!userId) throw new Error("apiResetUserPersonality: missing userId");
  return postJsonAuthed("resetUserPersonality", { userId });
}