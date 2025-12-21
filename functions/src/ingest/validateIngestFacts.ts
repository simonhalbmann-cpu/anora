// functions/src/ingest/validateIngestFacts.ts

import * as logger from "firebase-functions/logger";

export type BrainFactType = "property" | "tenant" | "event" | "person" | "generic";

export type BrainFactInput = {
  type: BrainFactType;
  tags?: string[];
  data?: Record<string, any>;
  raw?: string;
};

// Diese Funktion ist absichtlich "dumm": sie prüft nur Struktur, keine Semantik.
export function validateIngestFacts(
  userId: string,
  parsed: any,
  safeMeta: { filename?: string | null; source?: string | null },
  opts?: { maxFacts?: number }
): BrainFactInput[] {
  const MAX_FACTS = opts?.maxFacts ?? 50;

  if (!Array.isArray(parsed)) {
    logger.warn("ingest_validate_not_array", { userId, gotType: typeof parsed });
    return [];
  }

  const out: BrainFactInput[] = parsed
    .slice(0, MAX_FACTS)
    .map((f: any): BrainFactInput | null => {
      if (!f || typeof f !== "object") return null;

      const type = f.type as BrainFactType;
      if (
        type !== "property" &&
        type !== "tenant" &&
        type !== "event" &&
        type !== "person" &&
        type !== "generic"
      ) {
        logger.warn("ingest_fact_invalid_type", { userId, type: f.type });
        return null;
      }

      // raw ist Pflicht
      const rawText = typeof f.raw === "string" ? f.raw.trim() : "";
      if (!rawText) {
        logger.warn("ingest_fact_missing_raw", { userId, type });
        return null;
      }

      // tags: nur strings, max 10
      const safeTags: string[] = Array.isArray(f.tags)
        ? f.tags.filter((t: any) => typeof t === "string").slice(0, 10)
        : [];

      // Meta-Tags dazu (gekürzt)
      if (safeMeta.filename) safeTags.push(`filename:${String(safeMeta.filename).slice(0, 120)}`);
      if (safeMeta.source) safeTags.push(`source:${String(safeMeta.source).slice(0, 120)}`);

      // data: nur objekt + max 8000 chars json
      let safeData: Record<string, any> | undefined = undefined;
      if (f.data && typeof f.data === "object") {
        try {
          const json = JSON.stringify(f.data);
          if (json.length <= 8000) {
            safeData = f.data as Record<string, any>;
          } else {
            logger.warn("ingest_fact_data_too_large", {
              userId,
              type,
              length: json.length,
            });
          }
        } catch (err) {
          logger.warn("ingest_fact_data_stringify_failed", {
            userId,
            type,
            error: String(err),
          });
        }
      }

      return {
        type,
        tags: safeTags,
        data: safeData,
        raw: rawText.slice(0, 2000),
      };
    })
    .filter((x: BrainFactInput | null): x is BrainFactInput => x !== null);

  logger.info("ingest_validate_done", {
    userId,
    inputCount: parsed.length,
    outputCount: out.length,
  });

  return out;
}