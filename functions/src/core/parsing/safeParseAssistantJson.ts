// functions/src/core/parsing/safeParseAssistantJson.ts

import { logger } from "firebase-functions/v2";

function extractJsonBlock(raw: string): string {
  const trimmed = String(raw ?? "").trim();

  // 1) Falls schon reines JSON: passt
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    return trimmed;
  }

  // 2) ```json ... ``` Blöcke
  const fenceStart = trimmed.indexOf("```");
  if (fenceStart !== -1) {
    const fenceEnd = trimmed.indexOf("```", fenceStart + 3);
    if (fenceEnd !== -1) {
      const inside = trimmed.slice(fenceStart + 3, fenceEnd).trim();
      // optional "json" am Anfang entfernen
      return inside.replace(/^json\s*/i, "").trim();
    }
  }

  // 3) Finde ein JSON-Array im Text (erste [ ... letzte ])
  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    return trimmed.slice(firstArr, lastArr + 1).trim();
  }

  // 4) Fallback
  return trimmed;
}

export function safeParseAssistantJson(raw: string): any | null {
  const jsonCandidate = extractJsonBlock(raw);

  try {
    return JSON.parse(jsonCandidate);
  } catch (err) {
    logger.error("safeParseAssistantJson_failed", {
      raw,
      jsonCandidate,
      error: String(err),
    });
    return null;
  }
}