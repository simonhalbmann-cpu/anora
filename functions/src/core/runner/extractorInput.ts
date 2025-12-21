// functions/src/core/runner/extractorInput.ts
import type { RawEventDoc } from "../rawEvents/types";

export type ExtractorInputV1 = {
  rawEventId: string;
  locale: string;
  sourceType: string;
  payload: Record<string, any>;
  meta: Record<string, any>;
};

export function toExtractorInputV1(rawEventId: string, raw: RawEventDoc): ExtractorInputV1 {
  return {
    rawEventId,
    locale: raw.locale ?? "de-DE",
    sourceType: raw.sourceType ?? "unknown",
    payload: (raw.payload ?? {}) as Record<string, any>,
    meta: (raw.meta ?? {}) as Record<string, any>,
  };
}