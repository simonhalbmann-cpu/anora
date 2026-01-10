// functions/src/core/satellites/document-understanding/index.ts
import { hintInsurance } from "../domain-adapters/insurance";
import { hintLegal } from "../domain-adapters/legal";
import { hintRealEstate } from "../domain-adapters/real_estate";
import { hintTax } from "../domain-adapters/tax";
import type { SatelliteInput, SatelliteInsight, SatelliteOutput, SatelliteScores } from "../satelliteContract";
import { gateProposedFacts } from "./contract";
import { scoreUnderstandingConfidence } from "./understanding/confidence";
import { classifyDocType } from "./understanding/docType";
import { extractSignals } from "./understanding/signals";
import { detectStructure } from "./understanding/structure";

export const DOCUMENT_UNDERSTANDING_SATELLITE_ID =
  "document-understanding.v1" as const;

export const DOCUMENT_UNDERSTANDING_VERSION = "1.0.0" as const;

// TODO: Phase 3+ füllt das mit echter Logik.
// Jetzt: deterministischer Skeleton ohne Writes, ohne side effects.
export async function runDocumentUnderstandingSatellite(
  input: SatelliteInput
): Promise<SatelliteOutput> {

  const p = input.guaranteedInput.rawEvent.payload || {};

  const text = typeof p.text === "string" ? p.text : null;
  const filename = typeof p.filename === "string" ? p.filename : null;
  const mimeType = typeof p.mimeType === "string" ? p.mimeType : null;
  const isScanned = typeof p.isScanned === "boolean" ? p.isScanned : null;
  const pages = typeof p.pages === "number" ? p.pages : null;

  const docTypeRes = classifyDocType({
    text,
    filename,
    mimeType,
    isScanned,
    pages,
  });

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

const domainHintInput = {
    docTypeRes,
    structureRes,
    signalsRes,
    confidenceRes,
    hasText,
    scannedLike,
  };

  const domainHints = [
    hintRealEstate(domainHintInput),
    hintLegal(domainHintInput),
    hintInsurance(domainHintInput),
    hintTax(domainHintInput),
  ].sort((a, b) => b.confidence - a.confidence);

  const topDomain = domainHints[0] ?? null;

  // ----------------------------
  // PHASE 4.1: PROPOSED FACTS (NO WRITES)
  // ----------------------------
  const rawEventId = input.guaranteedInput.rawEvent.rawEventId;

  const docId =
    (input.guaranteedInput.rawEvent.meta?.docId as any) ??
    (input.guaranteedInput.rawEvent.meta?.uploadId as any) ??
    filename ??
    rawEventId;

  const proposedFactsRaw: any[] = [];

  // (A) rent_cold → ONLY if: topDomain=real_estate AND gates pass AND strong signal exists
  const rentCold = signalsRes.money.find((m) => m.kind === "rent_cold");

  if (
    topDomain?.domain === "real_estate" &&
    confidenceRes.overall >= confidenceRes.thresholds.proposeFactsMin &&
    rentCold &&
    rentCold.confidence >= 0.8
  ) {
    proposedFactsRaw.push({
      domain: "real_estate",
      key: "rent_cold",
      value: rentCold.amountEur,
      sourceRef: rawEventId,
      meta: {
        docId,
        confidence: Math.min(0.98, (confidenceRes.overall + rentCold.confidence) / 2),
        extractorId: DOCUMENT_UNDERSTANDING_SATELLITE_ID,
        reasonCodes: ["gate_ok", "topDomain_real_estate", "signal_money_rent_cold"],
        evidence: {
          signalsUsed: ["money:rent_cold"],
          snippets: [rentCold.evidence?.snippet ?? ""].filter(Boolean),
        },
      },
    });
  }

  // (B) generic doc:summary snapshot
// (bounded, no heavy payload)
if (hasText) {
  proposedFactsRaw.push({
    domain: "generic",
    key: "doc:summary",
    value: {
      docType: docTypeRes.docType,
      topDomain: topDomain ? { domain: topDomain.domain, confidence: topDomain.confidence } : null,
      sectionCount: structureRes.sections.length,
      signals: {
        money: signalsRes.money.length,
        deadlines: signalsRes.deadlines.length,
        parties: signalsRes.parties.length,
        objects: signalsRes.objectRefs.length,
      },
    },
    sourceRef: rawEventId,
    meta: {
      docId,
      confidence: confidenceRes.overall, // ok; gateProposedFacts clamped nur
      extractorId: DOCUMENT_UNDERSTANDING_SATELLITE_ID,
      reasonCodes: ["generic_doc_summary_minimal_fix"], // optional, aber hilfreich
    },
  });
}

  const proposedFacts = gateProposedFacts({ proposed: proposedFactsRaw as any[], max: 8 });

  // ----------------------------
  // INSIGHTS (deterministic)
  // ----------------------------
  const insights: SatelliteInsight[] = [
    {
      code: "doc_type_detected",
      data: {
        docType: docTypeRes.docType,
        confidence: docTypeRes.confidence,
        reason: docTypeRes.reason,
        topCandidates: (docTypeRes.candidates ?? []).slice(0, 3).map((c) => ({
          docType: c.docType,
          confidence: c.confidence,
        })),
      },
    },
    {
      code: "doc_structure_detected",
      data: {
        hasText,
        reason: structureRes.reason,
        confidence: structureRes.confidence,
        sectionCount: structureRes.sections.length,
        topSections: structureRes.sections.slice(0, 6).map((s) => ({
          kind: s.kind,
          title: s.title,
          startLine: s.startLine,
          endLine: s.endLine,
          confidence: s.confidence,
        })),
      },
    },
    {
      code: "doc_signals_extracted",
      data: {
        ok: signalsRes.ok,
        reason: signalsRes.reason,
        confidence: signalsRes.confidence,

        partyCount: signalsRes.parties.length,
        moneyCount: signalsRes.money.length,
        deadlineCount: signalsRes.deadlines.length,
        objectCount: signalsRes.objectRefs.length,

        // nur Top-N, damit bounded bleibt
        topParties: signalsRes.parties.slice(0, 2).map((p) => ({
          role: p.role,
          name: p.name,
          confidence: p.confidence,
        })),
        topMoney: signalsRes.money.slice(0, 4).map((m) => ({
          kind: m.kind,
          amountEur: m.amountEur,
          confidence: m.confidence,
        })),
        topDeadlines: signalsRes.deadlines.slice(0, 4).map((d) => ({
          kind: d.kind,
          dateISO: d.dateISO,
          confidence: d.confidence,
        })),
        topObjects: signalsRes.objectRefs.slice(0, 4).map((o) => ({
          kind: o.kind,
          value: o.value,
          confidence: o.confidence,
        })),
      },
    },
    {
      code: "doc_understanding_confidence",
      data: {
        overall: confidenceRes.overall,
        reason: confidenceRes.reason,
        breakdown: confidenceRes.breakdown,
        thresholds: confidenceRes.thresholds,
        flags: confidenceRes.flags,
      },
    },
    {
      code: "doc_domain_hints",
      data: {
        topDomain: topDomain ? { domain: topDomain.domain, confidence: topDomain.confidence, reason: topDomain.reason } : null,
        all: domainHints.slice(0, 4).map((d) => ({
          domain: d.domain,
          confidence: d.confidence,
          reason: d.reason,
          breakdown: d.breakdown,
          // hints bewusst NICHT komplett, nur bounded Teaser:
          hintKeys: Object.keys(d.hints ?? {}).slice(0, 12),
        })),
      },
    },
  {
      code: "doc_proposed_facts",
      data: {
        count: proposedFacts.length,
        top: proposedFacts.slice(0, 6).map((p) => ({
          domain: p.domain,
          key: p.key,
          confidence: p.meta?.confidence ?? null,
        })),
      },
    },
  ];

  // ----------------------------
  // SCORES (numeric, bounded)
  // ----------------------------
  const scores: SatelliteScores = {
  docTypeConfidence: docTypeRes.confidence,
  structureConfidence: structureRes.confidence,
  structureSectionCount: structureRes.sections.length,

  signalsConfidence: signalsRes.confidence,
  signalsMoneyCount: signalsRes.money.length,
  signalsDeadlineCount: signalsRes.deadlines.length,
  signalsPartyCount: signalsRes.parties.length,
  signalsObjectCount: signalsRes.objectRefs.length,

  understandingConfidence: confidenceRes.overall,
  understandingPenalties: confidenceRes.breakdown.penalties,
};

  // ----------------------------
  // DEBUG (never user-facing)
  // ----------------------------
  const debug: SatelliteOutput["debug"] = {
    note: "document-understanding: docType + structure + signals + confidence + domainHints",
    channel: input.channel,

    inputSummary: {
      hasText: !!text && text.length >= 40,
      textChars: typeof text === "string" ? text.length : 0,
      filename,
      mimeType,
      isScanned,
      pages,
    },

    docTypeRes,
    structureRes,
    confidenceRes,

    domainHints: domainHints.slice(0, 4).map((d) => ({
      domain: d.domain,
      confidence: d.confidence,
      reason: d.reason,
      breakdown: d.breakdown,
    })),

    // Debug darf mehr enthalten, aber wir halten es trotzdem bounded:
    signalsRes: {
      ok: signalsRes.ok,
      confidence: signalsRes.confidence,
      reason: signalsRes.reason,
      stats: signalsRes.stats,
      parties: signalsRes.parties.slice(0, 3),
      money: signalsRes.money.slice(0, 6),
      deadlines: signalsRes.deadlines.slice(0, 6),
      objectRefs: signalsRes.objectRefs.slice(0, 6),
    },
  };

  return {
    ok: true,
    satelliteId: DOCUMENT_UNDERSTANDING_SATELLITE_ID,
    version: 1,

    insights,
    hypotheses: [],
    risks: [],
    suggestions: proposedFacts.length
  ? [
      {
        kind: "propose_facts",
        facts: proposedFacts.map((pf) => ({
          domain: pf.domain,
          key: pf.key,
          value: pf.value,
          sourceRef: pf.sourceRef,
          meta: pf.meta,
        })),
      },
    ]
  : [],
    scores,
    debug,
  };
}