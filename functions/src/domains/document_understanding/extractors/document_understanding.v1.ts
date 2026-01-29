// functions/src/domains/document_understanding/extractors/document_understanding.v1.ts

import type { Extractor, ExtractorInput, ExtractorResult } from "../../../core/facts/types";

import { toEntityDomain } from "../../../core/entities/types";
import { scoreUnderstandingConfidence } from "../../../core/satellites/_deprecated/document-understanding/understanding/confidence";
import { classifyDocType } from "../../../core/satellites/_deprecated/document-understanding/understanding/docType";
import { extractSignals } from "../../../core/satellites/_deprecated/document-understanding/understanding/signals";
import { detectStructure } from "../../../core/satellites/_deprecated/document-understanding/understanding/structure";

// Extractor-ID muss exakt so heißen, weil CORE_FREEZE darauf prüft.
export const documentUnderstandingV1Extractor: Extractor = {
  id: "document_understanding.v1",
  domain: "generic",

  async extract(input: ExtractorInput): Promise<ExtractorResult> {
    const p = input.payload || {};

    const text = typeof p.text === "string" ? p.text : null;
    const filename = typeof p.filename === "string" ? p.filename : null;
    const mimeType = typeof p.mimeType === "string" ? p.mimeType : null;
    const isScanned = typeof p.isScanned === "boolean" ? p.isScanned : null;
    const pages = typeof p.pages === "number" ? p.pages : null;

    const docTypeRes = classifyDocType({ text, filename, mimeType, isScanned, pages });
    const structureRes = detectStructure({ text });
    const signalsRes = extractSignals({ text, filename, mimeType });

    const hasText = !!text && text.length >= 40;
    const scannedLike = signalsRes.stats?.scannedLike === true;

    const confidenceRes = scoreUnderstandingConfidence({
      docTypeRes,
      structureRes,
      signalsRes,
      hasText,
      scannedLike,
    });

    // V1: wir schreiben (erstmal) nur den generischen doc:summary Fact
    // (bounded, deterministisch). Später können wir mehr Facts hinzufügen.
    const facts: ExtractorResult["facts"] = [];

    if (hasText) {
      facts.push({
        domain: toEntityDomain("generic"),
        key: "doc:summary",
        value: {
          docType: docTypeRes.docType,
          sectionCount: structureRes.sections.length,
          signals: {
            money: signalsRes.money.length,
            deadlines: signalsRes.deadlines.length,
            parties: signalsRes.parties.length,
            objects: signalsRes.objectRefs.length,
          },
        },
        source: "raw_event",
        sourceRef: input.rawEventId,
        meta: {
          extractorId: "document_understanding.v1",
          confidence: confidenceRes.overall,
          reasonCodes: ["doc_summary_v1"],
        },
      });
    }

    return {
      facts,
      warnings: [],
    };
  },
};