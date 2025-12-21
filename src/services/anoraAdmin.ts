// src/services/anoraAdmin.ts

// Für Emulator im lokalen Netzwerk:
export const FUNCTIONS_BASE_URL =
  "http://192.168.178.141:5001/anoraapp-ai/us-central1";


// Für Emulator (falls nötig):
// const FUNCTIONS_BASE_URL = "http://127.0.0.1:5001/<project-id>/<region>";

async function postJson(path: string, body: any) {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Request failed: ${res.status} ${res.statusText} – ${text || "no body"}`
    );
  }

  return res.json();
}

// --------------------------------------------------------
// 1) Wissen komplett löschen (Panic Reset)
// --------------------------------------------------------
export async function apiResetUserKnowledge(userId: string) {
  return postJson("resetUserKnowledge", { userId });
}

// --------------------------------------------------------
// 2) Persönlichkeit zurücksetzen
// --------------------------------------------------------
export async function apiResetUserPersonality(userId: string) {
  return postJson("resetUserPersonality", { userId });
}