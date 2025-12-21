// functions/src/core/facts/runExtractor.ts
// Roadmap 3.8: Generic Extractor Runner (RawEvent -> Facts -> FactStore)

import { logger } from "firebase-functions/v2";
import { getRawEventById } from "../rawEvents/store";
import type { RawEventDoc } from "../rawEvents/types";
import { getExtractor } from "./registry";
import { upsertManyFacts } from "./store";

function defaultExtractorIdForEvent(e: RawEventDoc): string | null {
  // v0: nur ein SourceType vorhanden -> real_estate.v1
  if (e.sourceType === "ingest_document_text") return "real_estate.v1";
  return null;
}

export async function runExtractorOnRawEvent(params: {
  userId: string;
  rawEventId: string;
  extractorId?: string;
}) {
  const userId = String(params.userId || "").trim();
  const rawEventId = String(params.rawEventId || "").trim();
  const forcedExtractorId =
    typeof params.extractorId === "string" ? params.extractorId.trim() : "";

  if (!userId) throw new Error("runExtractorOnRawEvent: userId missing");
  if (!rawEventId) throw new Error("runExtractorOnRawEvent: rawEventId missing");

  const ev = await getRawEventById(userId, rawEventId);
  if (!ev) {
    return {
      ok: false,
      error: "RawEvent not found",
      userId,
      rawEventId,
    };
  }

  const extractorId =
    forcedExtractorId || defaultExtractorIdForEvent(ev) || "";

  if (!extractorId) {
    return {
      ok: false,
      error: "No extractorId (and no default mapping) for this RawEvent",
      userId,
      rawEventId,
      sourceType: ev.sourceType,
    };
  }

  const ex = getExtractor(extractorId);
  if (!ex) {
    return {
      ok: false,
      error: `Unknown extractorId: ${extractorId}`,
      userId,
      rawEventId,
    };
  }

  logger.info("runExtractor_start", {
    userId,
    rawEventId,
    extractorId,
    sourceType: ev.sourceType,
  });

  const result = await ex.extract({
    rawEventId,
    locale: ev.locale ?? "de-DE",
    sourceType: ev.sourceType,
    payload: (ev.payload as any) ?? {},
    meta: (ev.meta as any) ?? {},
  });

  const facts = Array.isArray(result?.facts) ? result.facts : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  // Hard guard v0 (damit nichts eskaliert)
  const MAX_FACTS = 500;
  const limitedFacts = facts.slice(0, MAX_FACTS);

  const write = await upsertManyFacts(userId, limitedFacts);

  logger.info("runExtractor_done", {
    userId,
    rawEventId,
    extractorId,
    factsIn: facts.length,
    factsWritten: limitedFacts.length,
    upserted: write.upserted,
    skipped: write.skipped,
    warningsCount: warnings.length,
  });

  return {
    ok: true,
    userId,
    rawEventId,
    extractorId,
    factsIn: facts.length,
    factsWritten: limitedFacts.length,
    upserted: write.upserted,
    skipped: write.skipped,
    warnings,
  };
}