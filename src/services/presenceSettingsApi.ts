// src/services/presenceSettingsApi.ts

// Entweder du exportierst die BASE_URL auch aus anoraAdmin.ts
// und verwendest hier:  import { FUNCTIONS_BASE_URL } from "./anoraAdmin";
// oder du lässt sie hier einfach nochmal stehen.
// Für jetzt machen wir es simpel und definieren sie hier:

const FUNCTIONS_BASE_URL =
  "http://192.168.178.141:5001/anoraapp-ai/us-central1";

type PresenceSettingsResponse = {
  ok: boolean;
  enabled: boolean;
};

export async function apiSetPresenceEnabled(
  userId: string,
  enabled: boolean
): Promise<PresenceSettingsResponse> {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/anoraPresenceSettings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, enabled }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log(
      "apiSetPresenceEnabled HTTP error",
      res.status,
      text
    );
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as PresenceSettingsResponse;
  return json;
}