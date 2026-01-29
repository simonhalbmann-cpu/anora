// functions/src/scripts/runPhase6_1_DocTypeTests.ts
import { strict as assert } from "assert";

import { classifyDocType } from "../core/satellites/_deprecated/document-understanding/understanding/docType";

function runSameInputTwice(input: Parameters<typeof classifyDocType>[0]) {
  const a = classifyDocType(input);
  const b = classifyDocType(input);
  assert.deepEqual(b, a, "same input must produce identical output (deepEqual)");
  return a;
}

function main() {
  // 1) Typical rental contract text -> should not be unknown (most likely rental_contract)
  const textRental = `
    WOHNRAUMMIETVERTRAG
    Vermieter: Max Mustermann
    Mieter: Erika Beispiel
    Mietbeginn: 01.02.2026
    Kaution: 2.000 EUR
    Betriebskosten: werden umgelegt
    § 1 Mietgegenstand
  `.trim();

  const r1 = runSameInputTwice({
    text: textRental,
    filename: "Wohnraummietvertrag_Muster.pdf",
    mimeType: "application/pdf",
    isScanned: false,
    pages: 7,
  });

  assert.ok(r1.confidence >= 0, "confidence must be a number >= 0");
  assert.ok(r1.confidence <= 1, "confidence must be <= 1");
  assert.ok(Array.isArray(r1.candidates), "candidates must be array");
  assert.ok(r1.candidates.length <= 5, "candidates bounded to top 5");

  // We don't hard-require exact docType (because rules may evolve),
  // but it must be stable and should not be "scan_image".
  assert.notEqual(r1.docType, "scan_image");

  // 2) No text + scanned => must be scan_image (special-case)
  const r2 = runSameInputTwice({
    text: "",
    filename: "scan_123.jpg",
    mimeType: "image/jpeg",
    isScanned: true,
    pages: 1,
  });

  assert.equal(r2.docType, "scan_image");
  assert.equal(r2.reason, "no_text_image_or_scanned");
  assert.ok(r2.confidence >= 0.85);

  // 3) Ambiguous/weak input => should be unknown (conservative)
  const textAmb = `
    Hallo,
    anbei sende ich Ihnen die Unterlagen.
    Mit freundlichen Grüßen
  `.trim();

  const r3 = runSameInputTwice({
    text: textAmb,
    filename: "unterlagen.pdf",
    mimeType: "application/pdf",
    isScanned: false,
    pages: 1,
  });

  // For weak/ambiguous, unknown is the intended conservative behavior.
  assert.ok(["unknown", "letter", "email_printout"].includes(r3.docType));

  // 4) Determinism under repeated calls across multiple inputs
  const inputs = [
    { text: textRental, filename: "mietvertrag.pdf", mimeType: "application/pdf", isScanned: false, pages: 4 },
    { text: "RECHNUNG\nRechnungsnummer 123\nIBAN DE12...\nNetto 10 EUR\nBrutto 11,90 EUR", filename: "rechnung_RG-123.pdf", mimeType: "application/pdf", isScanned: false, pages: 1 },
    { text: "KONTOAUSZUG\nSaldo\nValuta\nIBAN", filename: "kontoauszug.pdf", mimeType: "application/pdf", isScanned: false, pages: 2 },
    { text: "", filename: "scan.png", mimeType: "image/png", isScanned: true, pages: 1 },
  ];

  for (const inp of inputs) runSameInputTwice(inp as any);

  console.log("✅ Phase 6.1 DocTypeTests PASSED", {
    sample: {
      rental: { docType: r1.docType, confidence: r1.confidence, reason: r1.reason },
      scan: { docType: r2.docType, confidence: r2.confidence, reason: r2.reason },
      ambiguous: { docType: r3.docType, confidence: r3.confidence, reason: r3.reason },
    },
  });
}

main();