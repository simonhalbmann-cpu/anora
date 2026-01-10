// functions/src/core/satellites/document-understanding/understanding/confidence.ts
// Phase 3.4 — Confidence scoring (deterministic, conservative)
//
// Purpose:
// - Convert results of docType/structure/signals into a single confidence score.
// - Provide thresholds for "safe to propose" (later in Phase 4 we map to proposedFacts).
//
// HARD RULES:
// - deterministic only (no randomness, no time)
// - bounded output
// - conservative: "unknown" or scanned-like reduces confidence
// - this file does NOT create facts; it only scores.

import type { DocTypeResult } from "./docType";
import type { SignalsResult } from "./signals";
import type { StructureResult } from "./structure";

export type ConfidenceBreakdown = {
  docType: number;      // 0..1
  structure: number;    // 0..1
  signals: number;      // 0..1
  penalties: number;    // 0..1 (subtracted)
  overall: number;      // 0..1 (final)
};

export type ConfidenceResult = {
  ok: true;
  overall: number; // 0..1
  breakdown: ConfidenceBreakdown;

  // conservative gates used by later phases (Phase 4+)
  thresholds: {
    proposeFactsMin: number;        // >= => we MAY propose facts later
    proposeSignalsMin: number;      // >= => signals are reliable enough
    needsUserConfirmationBelow: number;
  };

  flags: {
    docTypeUnknown: boolean;
    hasText: boolean;
    scannedLike: boolean;
    lowStructure: boolean;
    lowSignals: boolean;
  };

  reason: string; // short deterministic string
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round3(n: number): number {
  return Number(clamp01(n).toFixed(3));
}

function isDocTypeUnknown(docTypeRes: DocTypeResult): boolean {
  return docTypeRes.docType === "unknown" || docTypeRes.confidence <= 0;
}

/**
 * Conservative scoring:
 * - docType matters, but unknown docType should not kill everything.
 * - structure matters more when text exists.
 * - signals are useful, but scanned-like reduces trust.
 *
 * We keep weights simple, stable, and easy to reason about.
 */
export function scoreUnderstandingConfidence(input: {
  docTypeRes: DocTypeResult;
  structureRes: StructureResult;
  signalsRes: SignalsResult;

  // derived from earlier steps (do NOT compute from current time)
  hasText: boolean;
  scannedLike: boolean;
}): ConfidenceResult {
  const docTypeScore = clamp01(input.docTypeRes.confidence);

  const structureScore =
    input.structureRes.ok ? clamp01(input.structureRes.confidence) : 0;

  const signalsScore =
    input.signalsRes.ok ? clamp01(input.signalsRes.confidence) : 0;

  const docTypeUnknown = isDocTypeUnknown(input.docTypeRes);

  // Penalties (conservative)
  let penalties = 0;

  // unknown docType => small penalty (not huge, because structure+signals can still be good)
  if (docTypeUnknown) penalties += 0.12;

  // no text => heavy penalty (understanding is limited)
  if (!input.hasText) penalties += 0.45;

  // scanned-like => reduces trust
  if (input.scannedLike) penalties += 0.18;

  // failed structure or very low structure => additional small penalty
  if (!input.structureRes.ok || structureScore < 0.30) penalties += 0.10;

  // signals weak => small penalty (but not fatal)
  if (!input.signalsRes.ok || signalsScore < 0.30) penalties += 0.08;

  penalties = clamp01(penalties);

  // Weights (simple + deterministic)
  // Structure and Signals matter more than docType for "understanding"
  // because docType can be fooled by filename-only.
  const W = {
    docType: 0.22,
    structure: 0.38,
    signals: 0.40,
  };

  const base =
    docTypeScore * W.docType +
    structureScore * W.structure +
    signalsScore * W.signals;

  // Apply penalties
  const overall = round3(clamp01(base - penalties));

  // Thresholds (conservative defaults)
  // - proposeFactsMin: very high; in Phase 4 we'll only propose facts above this.
  // - proposeSignalsMin: medium-high; signals can be used for digest/stats earlier.
  const thresholds = {
    proposeFactsMin: 0.78,
    proposeSignalsMin: 0.58,
    needsUserConfirmationBelow: 0.45,
  };

  const flags = {
    docTypeUnknown,
    hasText: input.hasText,
    scannedLike: input.scannedLike,
    lowStructure: structureScore < 0.35,
    lowSignals: signalsScore < 0.35,
  };

  // Deterministic reason string
  const reasonParts: string[] = [];
  if (!flags.hasText) reasonParts.push("no_text");
  if (flags.scannedLike) reasonParts.push("scanned_like");
  if (flags.docTypeUnknown) reasonParts.push("doctype_unknown");
  if (flags.lowStructure) reasonParts.push("low_structure");
  if (flags.lowSignals) reasonParts.push("low_signals");
  if (reasonParts.length === 0) reasonParts.push("ok");

  return {
    ok: true,
    overall,
    breakdown: {
      docType: round3(docTypeScore),
      structure: round3(structureScore),
      signals: round3(signalsScore),
      penalties: round3(penalties),
      overall,
    },
    thresholds,
    flags,
    reason: reasonParts.join("|"),
  };
}