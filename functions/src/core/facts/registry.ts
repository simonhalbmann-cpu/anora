import type { Extractor } from "./types";

const EXTRACTORS = new Map<string, Extractor>();

export function registerExtractor(extractor: Extractor): void {
  if (!extractor || typeof extractor !== "object") {
    throw new Error("registerExtractor: extractor missing");
  }
  if (!extractor.id || typeof extractor.id !== "string") {
    throw new Error("registerExtractor: extractor.id missing");
  }
  if (typeof extractor.extract !== "function") {
    throw new Error("registerExtractor: extractor.extract missing");
  }

  EXTRACTORS.set(extractor.id, extractor);
}

export function getExtractor(id: string): Extractor | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return EXTRACTORS.get(key) ?? null;
}

export function listExtractors(): string[] {
  return Array.from(EXTRACTORS.keys()).sort();
}