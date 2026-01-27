// functions/src/scripts/runPhase6_1_ConfidenceTests.ts
import { strict as assert } from "assert";

import { scoreUnderstandingConfidence } from "../core/satellites/document-understanding/understanding/confidence";
import type { DocTypeResult } from "../core/satellites/document-understanding/understanding/docType";
import type { SignalsResult } from "../core/satellites/document-understanding/understanding/signals";
import type { StructureResult } from "../core/satellites/document-understanding/understanding/structure";

function mkDocType(docType: any, confidence: number): DocTypeResult {
  return {
    docType,
    confidence,
    candidates: [],
    reason: "test",
  } as any;
}

function mkStructure(ok: boolean, confidence: number): StructureResult {
  return {
    ok,
    confidence,
    reason: "test",
    sections: [],
  } as any;
}

function mkSignals(ok: boolean, confidence: number, scannedLike: boolean): SignalsResult {
  return {
    ok,
    confidence,
    reason: "test",
    parties: [],
    money: [],
    deadlines: [],
    objectRefs: [],
    stats: { scannedLike },
  } as any;
}

function runTwiceSame(input: Parameters<typeof scoreUnderstandingConfidence>[0]) {
  const a = scoreUnderstandingConfidence(input);
  const b = scoreUnderstandingConfidence(input);
  assert.deepEqual(b, a, "same input must yield identical output");
  return a;
}

function assertBetween01(x: number, label: string) {
  assert.ok(Number.isFinite(x), `${label} must be finite`);
  assert.ok(x >= 0 && x <= 1, `${label} must be in [0,1]`);
}

function main() {
  // Threshold constants (from file)
  const PROPOSE_FACTS_MIN = 0.78;
  const NEED_CONFIRM_BELOW = 0.45;

  // Case A: Strong signals + structure + docType, hasText=true, scannedLike=false
  // Expect: high overall, likely >= proposeFactsMin
  const strong = runTwiceSame({
    docTypeRes: mkDocType("rental_contract", 0.95),
    structureRes: mkStructure(true, 0.9),
    signalsRes: mkSignals(true, 0.9, false),
    hasText: true,
    scannedLike: false,
  });

  assertBetween01(strong.overall, "strong.overall");
  assert.ok(strong.overall >= PROPOSE_FACTS_MIN, `strong should reach proposeFactsMin (${PROPOSE_FACTS_MIN})`);
  assert.equal(strong.reason, "ok");

  // Case B: No text => must drop hard (penalty 0.45), should be below needsUserConfirmationBelow
  const noText = runTwiceSame({
    docTypeRes: mkDocType("invoice", 0.95),
    structureRes: mkStructure(true, 0.9),
    signalsRes: mkSignals(true, 0.9, false),
    hasText: false,
    scannedLike: false,
  });

  assertBetween01(noText.overall, "noText.overall");
  assert.ok(noText.overall < NEED_CONFIRM_BELOW, `noText should be below needsUserConfirmationBelow (${NEED_CONFIRM_BELOW})`);
  assert.ok(noText.reason.includes("no_text"));

  // Case C: scannedLike=true should reduce vs same input scannedLike=false
  const notScanned = runTwiceSame({
    docTypeRes: mkDocType("invoice", 0.8),
    structureRes: mkStructure(true, 0.8),
    signalsRes: mkSignals(true, 0.8, false),
    hasText: true,
    scannedLike: false,
  });

  const scanned = runTwiceSame({
    docTypeRes: mkDocType("invoice", 0.8),
    structureRes: mkStructure(true, 0.8),
    signalsRes: mkSignals(true, 0.8, true),
    hasText: true,
    scannedLike: true,
  });

  assertBetween01(notScanned.overall, "notScanned.overall");
  assertBetween01(scanned.overall, "scanned.overall");
  assert.ok(scanned.overall < notScanned.overall, "scannedLike must reduce overall");
  assert.ok(scanned.reason.includes("scanned_like"));

  // Case D: unknown docType should reduce slightly vs known docType
  const known = runTwiceSame({
    docTypeRes: mkDocType("letter", 0.7),
    structureRes: mkStructure(true, 0.7),
    signalsRes: mkSignals(true, 0.7, false),
    hasText: true,
    scannedLike: false,
  });

  const unknown = runTwiceSame({
    docTypeRes: mkDocType("unknown", 0.0),
    structureRes: mkStructure(true, 0.7),
    signalsRes: mkSignals(true, 0.7, false),
    hasText: true,
    scannedLike: false,
  });

  assert.ok(unknown.overall < known.overall, "unknown docType must reduce overall");
  assert.ok(unknown.reason.includes("doctype_unknown"));

  // Case E: low structure and low signals should be reflected in flags and reason
  const low = runTwiceSame({
    docTypeRes: mkDocType("invoice", 0.6),
    structureRes: mkStructure(true, 0.2),
    signalsRes: mkSignals(true, 0.2, false),
    hasText: true,
    scannedLike: false,
  });

  assert.ok(low.flags.lowStructure, "lowStructure flag must be true");
  assert.ok(low.flags.lowSignals, "lowSignals flag must be true");
  assert.ok(low.reason.includes("low_structure"));
  assert.ok(low.reason.includes("low_signals"));

  // Sanity: breakdown fields bounded
  for (const [k, v] of Object.entries(low.breakdown)) {
    if (typeof v === "number") assertBetween01(v, `breakdown.${k}`);
  }

  console.log("✅ Phase 6.1 ConfidenceTests PASSED", {
    strong: { overall: strong.overall, reason: strong.reason },
    noText: { overall: noText.overall, reason: noText.reason },
    scanned: { overall: scanned.overall, reason: scanned.reason },
    unknown: { overall: unknown.overall, reason: unknown.reason },
    low: { overall: low.overall, reason: low.reason },
  });
}

main();