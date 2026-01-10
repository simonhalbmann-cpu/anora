// functions/src/documentPolicy.ts

/**
 * Qualitätsstufe eines Dokuments nach einer billigen Voranalyse.
 */
export type DocumentQuality = "low" | "medium" | "high";

/**
 * Eingangsdaten für die Dokument-Strategie.
 * Das ist bewusst einfach gehalten – wir wollen nur entscheiden:
 * - lokal & billig auslesen
 * - oder "teure" KI-Analyse (später / mit Bezahllogik)
 */
export interface DocumentInput {
  mimeType: string;        // z.B. "application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  pages: number;           // grobe Seitenzahl
  textChars: number;       // ungefähre Zeichenanzahl des erkannten Textes (0, wenn noch nicht extrahiert)
  isScanned: boolean;      // true = erkennbar nur Bild/Pixels (gescannt), false = Text-PDF / echte Textdatei
  hasTables: boolean;      // true = enthält sichtbare Tabellen/Spalten (z.B. Rechnungen, Nebenkostenabrechnung)
  quality: DocumentQuality;// Einschätzung: "low" = schlecht lesbar, "medium" = ok, "high" = sehr gut
}

/**
 * Entscheidung, wie das Dokument verarbeitet werden soll.
 */
export type DocumentStrategy =
  | "skip"            // ignorieren / nicht verarbeiten
  | "local-cheap"     // lokal, billig (z.B. kostenloser Parser, einfache Heuristik)
  | "ai-light"        // leichte KI-Analyse (wenig Tokens)
  | "ai-heavy";       // schwere KI-Analyse (viele Tokens, nur bei Bedarf)

export interface DocumentDecision {
  strategy: DocumentStrategy;
  reason: string;
  estimatedCostCents: number; // grobe Kostenschätzung in Cent (für dein Bauchgefühl / spätere Limits)
}

/**
 * Zentrale Entscheidungslogik für Hybrid-Verarbeitung von Dokumenten.
 * Nur PDFs und "echte Textdateien" (txt, docx, xlsx, csv, usw.) sind erlaubt.
 * Gescannte PDFs mit schlechter Qualität werden als "teuer" markiert.
 */
export function decideDocumentProcessingStrategy(
  input: DocumentInput
): DocumentDecision {
  const { mimeType, pages, isScanned, hasTables, quality } = input;

  // 1) MIME-Whitelist:
  const lowerMime = mimeType.toLowerCase();

  const isPdf = lowerMime === "application/pdf";
  const isPlainText = lowerMime === "text/plain";
  const isWord =
    lowerMime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerMime === "application/msword";
  const isExcel =
    lowerMime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lowerMime === "application/vnd.ms-excel";
  const isCsv = lowerMime === "text/csv";

  const isAllowedTextDoc =
    isPlainText || isWord || isExcel || isCsv;

  // Alles andere (z.B. JPG, PNG, unbekannt) → skip
  if (!isPdf && !isAllowedTextDoc) {
    return {
      strategy: "skip",
      reason: `MIME-Typ ${mimeType} ist nicht erlaubt (z.B. Bild/Foto).`,
      estimatedCostCents: 0,
    };
  }

  // 2) Nicht gescannte PDFs oder echte Textdateien:
  // Diese können wir mit "billigen" Tools (lokale Parser, Open-Source OCR, etc.) auslesen.
  if (!isScanned || isAllowedTextDoc) {
    // Einfache grobe Kostenschätzung: reine Parsing-Kosten sind quasi 0.
    return {
      strategy: "local-cheap",
      reason:
        "Nicht gescanntes PDF oder echte Textdatei – kann lokal / günstig geparst werden.",
      estimatedCostCents: 0,
    };
  }

  // AB HIER: Gescanntes PDF (isScanned = true) → potenziell teuer.

  // 3) Sehr kurze, gut lesbare Scans (z.B. 1 Seite, gute Qualität)
  if (pages <= 2 && quality === "high" && !hasTables) {
    return {
      strategy: "ai-light",
      reason:
        "Kurzes, gut lesbares gescanntes PDF ohne komplizierte Tabellen – leichte KI-Analyse möglich.",
      estimatedCostCents: 2, // grob 2 Cent
    };
  }

  // 4) Größere oder komplexere gescannte PDFs (Tabellen, viele Seiten, schlechte Qualität)
  let baseCost = pages * 2; // Daumenregel: 2 Cent pro Seite bei AI-heavy

  if (hasTables) baseCost += 5;
  if (quality === "low") baseCost += 5;

  return {
    strategy: "ai-heavy",
    reason:
      "Gescannte PDF-Datei mit mehreren Seiten oder Tabellen – teure KI-Analyse, nur bei Bedarf durchführen und ggf. separat berechnen.",
    estimatedCostCents: baseCost,
  };
}