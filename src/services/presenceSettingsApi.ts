// src/services/presenceSettingsApi.ts

// Entweder du exportierst die BASE_URL auch aus anoraAdmin.ts
// und verwendest hier:  import { FUNCTIONS_BASE_URL } from "./anoraAdmin";
// oder du lässt sie hier einfach nochmal stehen.
// Für jetzt machen wir es simpel und definieren sie hier:

import { postJsonAuthed } from "./anoraAdmin";

type PresenceSettingsResponse = {
  ok: boolean;
  enabled: boolean;
};

export async function apiSetPresenceEnabled(
  enabled: boolean
): Promise<PresenceSettingsResponse> {
  const json = (await postJsonAuthed("anoraPresenceSettings", { enabled })) as PresenceSettingsResponse;
  return json;
}