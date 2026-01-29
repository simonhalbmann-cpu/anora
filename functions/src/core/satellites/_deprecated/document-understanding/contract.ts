// functions/src/core/satellites/document-understanding/contract.ts
// Public contract for document-understanding satellite (stable exports)
//
// Purpose:
// - Provide stable types + constants for other pure modules (adapters/tests)
// - Avoid importing deep internal files from the outside
//
// HARD RULES:
// - PURE (no firebase imports, no side effects)
// - Keep bounded and stable

import type { ConfidenceResult } from "./understanding/confidence";
import type { DocTypeResult } from "./understanding/docType";
import type { SignalsResult } from "./understanding/signals";
import type { StructureResult } from "./understanding/structure";

/**
 * Minimal payload fields that document-understanding can consume.
 * Note: text is optional; without text we will be conservative.
 */
export type DocumentUnderstandingPayload = {
  text?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  isScanned?: boolean | null;
  pages?: number | null;
};

/**
 * Insight codes emitted by this satellite.
 * Keep this list stable for downstream consumers.
 */
export const DOCUMENT_UNDERSTANDING_INSIGHTS = {
  DOC_TYPE: "doc_type_detected",
  DOC_STRUCTURE: "doc_structure_detected",
  DOC_SIGNALS: "doc_signals_extracted",
  DOC_UNDERSTANDING_CONFIDENCE: "doc_understanding_confidence",
  // reserved: domain hints (added in Phase 3.5)
  code: "doc_domain_hints",
} as const;

export type DocumentUnderstandingInsightCode =
  (typeof DOCUMENT_UNDERSTANDING_INSIGHTS)[keyof typeof DOCUMENT_UNDERSTANDING_INSIGHTS];

/**
 * Internal results bundle (useful for tests and domain adapters).
 * This is NOT a SatelliteOutput; it is a typed bundle of step results.
 */
export type DocumentUnderstandingBundleV1 = {
  payload: DocumentUnderstandingPayload;

  docTypeRes: DocTypeResult;
  structureRes: StructureResult;
  signalsRes: SignalsResult;
  confidenceRes: ConfidenceResult;

  derived: {
    hasText: boolean;
    scannedLike: boolean;
  };
};

// ----------------------------
// PHASE 4.1 — Proposed Facts (pure)
// ----------------------------

// Local allowlists (satellite-safe). Keep in sync with Core Freeze.
const ALLOWED_DOMAINS = ["real_estate", "generic"] as const;
const ALLOWED_KEYS = ["city", "rent_cold", "doc:summary"] as const;

export type ProposedFactV1 = {
  domain: (typeof ALLOWED_DOMAINS)[number];
  key: (typeof ALLOWED_KEYS)[number];
  value: any;

  sourceRef: string; // rawEventId
  meta?: {
    docId?: string | null;
    confidence?: number; // 0..1
    extractorId?: string;
    reasonCodes?: string[];
    evidence?: {
      snippets?: string[];
      signalsUsed?: string[];
    };
  };
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function isAllowedDomain(d: any): d is ProposedFactV1["domain"] {
  return (ALLOWED_DOMAINS as readonly string[]).includes(String(d));
}

function isAllowedKey(k: any): k is ProposedFactV1["key"] {
  return (ALLOWED_KEYS as readonly string[]).includes(String(k));
}

export function gateProposedFacts(input: {
  proposed: ProposedFactV1[];
  max?: number;
}): ProposedFactV1[] {
  const max = typeof input.max === "number" ? input.max : 8;
  const arr = Array.isArray(input.proposed) ? input.proposed : [];

  const out: ProposedFactV1[] = [];

  for (const p of arr) {
    if (!p) continue;

    if (!isAllowedDomain((p as any).domain)) continue;
    if (!isAllowedKey((p as any).key)) continue;

    const meta = (p as any).meta ?? {};
    const conf =
      typeof meta.confidence === "number"
        ? Number(clamp01(meta.confidence).toFixed(3))
        : undefined;

    out.push({
      domain: p.domain,
      key: p.key,
      value: (p as any).value,
      sourceRef: String((p as any).sourceRef ?? ""),
      meta: {
        docId: meta.docId ?? null,
        confidence: conf,
        extractorId: typeof meta.extractorId === "string" ? meta.extractorId : undefined,
        reasonCodes: Array.isArray(meta.reasonCodes) ? meta.reasonCodes.slice(0, 8) : undefined,
        evidence: meta.evidence
          ? {
              snippets: Array.isArray(meta.evidence.snippets) ? meta.evidence.snippets.slice(0, 4) : undefined,
              signalsUsed: Array.isArray(meta.evidence.signalsUsed)
                ? meta.evidence.signalsUsed.slice(0, 8)
                : undefined,
            }
          : undefined,
      },
    });

    if (out.length >= max) break;
  }

  // deterministic order
  return out.sort((a, b) => `${a.domain}:${a.key}`.localeCompare(`${b.domain}:${b.key}`));
}