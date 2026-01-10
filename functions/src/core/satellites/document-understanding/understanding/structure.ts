// functions/src/core/satellites/document-understanding/understanding/structure.ts
// Phase 3.2 — Structure detection (deterministic, local-cheap)

export type SectionKind =
  | "heading"
  | "legal_section"
  | "annex"
  | "paragraph"
  | "table_like"
  | "signature_block"
  | "page_marker"
  | "unknown";

export type DetectedSection = {
  kind: SectionKind;
  title: string;                 // short, may be ""
  startLine: number;             // 0-based
  endLine: number;               // inclusive, 0-based
  confidence: number;            // 0..1
  evidence: {
    patterns: string[];          // rule names hit
    preview: string;             // short text preview
  };
};

export type StructureResult =
  | {
      ok: true;
      confidence: number; // 0..1 overall structure confidence
      sections: DetectedSection[];
      stats: {
        lines: number;
        hasText: boolean;
        hasPageMarkers: boolean;
        hasParagraphMarks: boolean;
        hasAnnex: boolean;
        hasTableLike: boolean;
      };
      reason: string; // deterministic short string
    }
  | {
      ok: false;
      confidence: number; // 0..1 overall structure confidence (usually 0)
      sections: DetectedSection[];
      stats: {
        lines: number;
        hasText: boolean;
        hasPageMarkers: boolean;
        hasParagraphMarks: boolean;
        hasAnnex: boolean;
        hasTableLike: boolean;
      };
      reason: string;
    };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeLine(s: string): string {
  const x = String(s ?? "");
  // keep original for previews; normalize only for matching
  return x
    .replace(/\u00A0/g, " ")
    .replace(/[^\p{L}\p{N}\s§]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function previewOf(raw: string): string {
  const p = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (p.length <= 140) return p;
  return p.slice(0, 140) + "…";
}

function isMostlyUppercase(lineRaw: string): boolean {
  const s = String(lineRaw ?? "").trim();
  if (s.length < 6) return false;
  const letters = s.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (letters.length < 6) return false;
  const upp = letters.replace(/[^A-ZÄÖÜ]/g, "").length;
  return upp / letters.length >= 0.75;
}

function looksLikeHeading(lineRaw: string, norm: string): boolean {
  if (!norm) return false;

  // common headings / typical German doc headings
  const headingKeywords = [
    "betreff",
    "gegenstand",
    "vereinbarung",
    "mietvertrag",
    "nachtrag",
    "zusatz",
    "kündigung",
    "kuendigung",
    "mieterhöhung",
    "mieterhoehung",
    "betriebskostenabrechnung",
    "nebenkostenabrechnung",
    "abrechnung",
    "zahlung",
    "frist",
    "hinweis",
    "anlage",
    "anlagen",
    "anhang",
    "unterschrift",
  ];

  // short-ish line + ends without punctuation + has keyword OR looks uppercase
  const shortEnough = norm.length <= 90;
  const endsClean = !/[;,.]$/.test(norm);
  const hasKeyword = headingKeywords.some((k) => norm.includes(normalizeLine(k)));

  if ((shortEnough && endsClean && hasKeyword) || isMostlyUppercase(lineRaw)) {
    return true;
  }

  // patterns: "I. ...", "1. ...", "A) ..."
  if (/^([ivx]{1,6}\.|[0-9]{1,2}\.|[a-z]\)|[a-z]\.)\s+/.test(norm)) return true;

  return false;
}

function looksLikeLegalSection(norm: string): boolean {
  // § 1, §2 etc.
  if (/^§\s*\d+/.test(norm)) return true;
  if (/^paragraph\s*\d+/.test(norm)) return true;
  return false;
}

function looksLikeAnnex(norm: string): boolean {
  // Anlage 1, Anlagen, Anhang
  if (/^(anlage|anlagen|anhang)\b/.test(norm)) return true;
  return false;
}

function looksLikePageMarker(norm: string): boolean {
  // Seite 1 von 3, Page 2/5, --- Seite 2 ---
  if (/\bseite\s+\d+\s*(von|\/)\s*\d+\b/.test(norm)) return true;
  if (/^[-–—]{2,}\s*seite\s+\d+/.test(norm)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(norm)) return true;
  return false;
}

function looksLikeTableLine(raw: string, norm: string): boolean {
  // crude heuristics: many separators or many numbers in a row
  const sepCount = (raw.match(/[|;:\t]/g) ?? []).length;
  if (sepCount >= 3) return true;

  const numCount = (norm.match(/\b\d+([.,]\d+)?\b/g) ?? []).length;
  if (numCount >= 6) return true;

  const multiSpaces = (raw.match(/\s{3,}/g) ?? []).length;
  if (multiSpaces >= 2 && numCount >= 3) return true;

  return false;
}

function looksLikeSignature(norm: string): boolean {
  // greetings + signature cues
  if (/\bmit freundlichen grüßen\b/.test(norm)) return true;
  if (/\bmit freundlichen gruessen\b/.test(norm)) return true;
  if (/\bhochachtungsvoll\b/.test(norm)) return true;
  if (/\bunterschrift\b/.test(norm)) return true;
  if (/\bort\s*,?\s*datum\b/.test(norm)) return true;
  if (/\bgez\.\b/.test(norm)) return true;
  return false;
}

function computeConfidence(kind: SectionKind, patterns: string[]): number {
  // deterministic: more specific patterns => higher confidence
  const base =
    kind === "legal_section" ? 0.86 :
    kind === "annex" ? 0.82 :
    kind === "page_marker" ? 0.85 :
    kind === "signature_block" ? 0.75 :
    kind === "table_like" ? 0.70 :
    kind === "heading" ? 0.68 :
    kind === "paragraph" ? 0.55 :
    0.40;

  const bonus = Math.min(0.18, patterns.length * 0.06);
  return Number(clamp01(base + bonus).toFixed(3));
}

function computeOverallConfidence(sections: DetectedSection[], stats: { lines: number; hasText: boolean; hasPageMarkers: boolean; hasParagraphMarks: boolean; hasAnnex: boolean; hasTableLike: boolean; }): number {
  if (!stats.hasText) return 0;

  if (sections.length === 0) return 0.2;

  // weight “strong” structural markers higher
  const strongKinds = new Set<SectionKind>(["legal_section", "heading", "annex", "page_marker", "signature_block", "table_like"]);
  let strongCount = 0;
  let sum = 0;

  for (const s of sections) {
    sum += s.confidence;
    if (strongKinds.has(s.kind)) strongCount++;
  }

  const avg = sum / sections.length; // 0..1
  const strongRatio = strongCount / sections.length; // 0..1

  // boost when we have strong markers, but never exceed 0.95 in local-cheap mode
  const conf = 0.55 * avg + 0.35 * strongRatio + 0.10 * (stats.hasPageMarkers ? 1 : 0);
  return Number(clamp01(Math.min(conf, 0.95)).toFixed(3));
}

export function detectStructure(input: { text?: string | null }): StructureResult {
  const rawText = typeof input.text === "string" ? input.text : "";
  const linesRaw = rawText.split(/\r?\n/);

  const hasText = rawText.trim().length >= 40;
  const stats = {
    lines: linesRaw.length,
    hasText,
    hasPageMarkers: false,
    hasParagraphMarks: false,
    hasAnnex: false,
    hasTableLike: false,
  };

  if (!hasText) {
    return {
      ok: false,
      confidence: 0,
      sections: [],
      stats,
      reason: "no_text_or_too_short",
    };
  }

  const linesNorm = linesRaw.map((l) => normalizeLine(l));

  // First pass: label each line with a "best kind"
  const lineKind: SectionKind[] = [];
  const linePatterns: string[][] = [];

  for (let i = 0; i < linesNorm.length; i++) {
    const norm = linesNorm[i];
    const raw = linesRaw[i];
    const patterns: string[] = [];

    let kind: SectionKind = "paragraph";

    if (looksLikePageMarker(norm)) {
      kind = "page_marker";
      patterns.push("page_marker");
      stats.hasPageMarkers = true;
    } else if (looksLikeLegalSection(norm)) {
      kind = "legal_section";
      patterns.push("legal_section");
      stats.hasParagraphMarks = true;
    } else if (looksLikeAnnex(norm)) {
      kind = "annex";
      patterns.push("annex");
      stats.hasAnnex = true;
    } else if (looksLikeSignature(norm)) {
      kind = "signature_block";
      patterns.push("signature");
    } else if (looksLikeTableLine(raw, norm)) {
      kind = "table_like";
      patterns.push("table_like");
      stats.hasTableLike = true;
    } else if (looksLikeHeading(raw, norm)) {
      kind = "heading";
      patterns.push("heading");
    } else {
      // empty line becomes unknown (helps splitting)
      if (!norm) {
        kind = "unknown";
        patterns.push("blank");
      } else {
        kind = "paragraph";
        patterns.push("paragraph");
      }
    }

    lineKind.push(kind);
    linePatterns.push(patterns);
  }

  // Second pass: group contiguous lines into sections
  const sections: DetectedSection[] = [];
  let start = 0;

  function flush(end: number) {
    if (end < start) return;

    const kinds = lineKind.slice(start, end + 1).filter((k) => k !== "unknown");
    const dominant = dominantKind(kinds);

    const patterns = uniquePatterns(linePatterns.slice(start, end + 1).flat());
    const title = inferTitle(dominant, linesRaw.slice(start, end + 1), linesNorm.slice(start, end + 1));

    sections.push({
      kind: dominant,
      title,
      startLine: start,
      endLine: end,
      confidence: computeConfidence(dominant, patterns),
      evidence: {
        patterns,
        preview: previewOf(linesRaw[start] ?? ""),
      },
    });
  }

  function dominantKind(kinds: SectionKind[]): SectionKind {
    if (kinds.length === 0) return "unknown";
    const counts = new Map<SectionKind, number>();
    for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
    const ordered: SectionKind[] = [
      "legal_section",
      "annex",
      "heading",
      "table_like",
      "signature_block",
      "page_marker",
      "paragraph",
      "unknown",
    ];
    let best: SectionKind = "paragraph";
    let bestCount = -1;
    for (const k of ordered) {
      const c = counts.get(k) ?? 0;
      if (c > bestCount) {
        bestCount = c;
        best = k;
      }
    }
    return best;
  }

  function uniquePatterns(p: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of p) {
      const k = String(x || "").trim();
      if (!k) continue;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    return out.slice(0, 8); // bound
  }

  function inferTitle(kind: SectionKind, raw: string[], norm: string[]): string {
    // For headings/legal sections/annex: use the first meaningful line
    for (let i = 0; i < raw.length; i++) {
      if (!norm[i]) continue;
      const t = raw[i].replace(/\s+/g, " ").trim();
      if (!t) continue;

      if (kind === "legal_section") {
        // keep short: "§ 1 ..." or first line
        return t.length > 90 ? t.slice(0, 90) + "…" : t;
      }
      if (kind === "heading" || kind === "annex" || kind === "page_marker") {
        return t.length > 90 ? t.slice(0, 90) + "…" : t;
      }
      if (kind === "signature_block") {
        return "signature_block";
      }
      if (kind === "table_like") {
        return "table_like";
      }
      break;
    }
    return "";
  }

  // Grouping rule:
  // - split on blank lines (unknown)
  // - split when lineKind changes to a "strong boundary" (heading/legal_section/annex/page_marker)
  const boundaryKinds = new Set<SectionKind>(["heading", "legal_section", "annex", "page_marker"]);

  start = 0;
  for (let i = 0; i < lineKind.length; i++) {
    const k = lineKind[i];

    const isBlank = k === "unknown";
    const next = i + 1 < lineKind.length ? lineKind[i + 1] : null;

    if (isBlank) {
      flush(i - 1);
      start = i + 1;
      continue;
    }

    // If next line begins a boundary kind and current section already has content, flush before boundary
    if (next && boundaryKinds.has(next) && i >= start) {
      flush(i);
      start = i + 1;
      continue;
    }
  }
  flush(lineKind.length - 1);

  // Post-filter: remove tiny paragraph-only sections that are just noise
  const cleaned = sections.filter((s) => {
    const len = s.endLine - s.startLine + 1;
    if (s.kind === "paragraph" && len <= 1 && !s.title) return false;
    return true;
  });

  const bounded = cleaned.slice(0, 60); // bound output
  const overall = computeOverallConfidence(bounded, stats);

  return {
    ok: true,
    confidence: overall,
    sections: bounded,
    stats,
    reason: "structure_detected",
  };
}