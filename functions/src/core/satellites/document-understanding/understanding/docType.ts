// functions/src/core/satellites/document-understanding/understanding/docType.ts
// Phase 3.1 — Cheap docType classifier (deterministic, local-cheap)

export const DOC_TYPES = [
  "rental_contract",
  "rental_addendum",
  "handover_protocol",
  "termination_notice",
  "rent_increase_notice",
  "operating_cost_statement",
  "utility_bill",
  "repair_offer",
  "repair_invoice",
  "invoice",
  "receipt",
  "bank_statement",
  "reminder_dunning",
  "court_decision",
  "court_order",
  "legal_letter",
  "authority_letter",
  "tax_assessment",
  "insurance_policy",
  "email_printout",
  "letter",
  "report",
  "official_form",
  "scan_image",
  "unknown",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export type DocTypeCandidate = {
  docType: DocType;
  score: number;          // internal raw score
  confidence: number;     // normalized 0..1
  evidence: {
    filenameHits: string[];
    textHits: string[];
    regexHits: string[];
    negativeHits: string[];
  };
};

export type DocTypeResult = {
  docType: DocType;
  confidence: number; // 0..1
  candidates: DocTypeCandidate[]; // sorted desc, top N
  reason: string; // short deterministic string (no prose essays)
};

type RuleSet = {
  docType: DocType;

  // strong signals (higher weight)
  strongText: string[];
  strongFilename: string[];
  strongRegex: Array<{ name: string; re: RegExp }>;

  // weak signals (lower weight)
  weakText: string[];
  weakFilename: string[];

  // negative signals (penalize heavily)
  negativeText: string[];
  negativeFilename: string[];
};

function normalize(s: string): string {
  const x = String(s || "").toLowerCase();

  // normalize umlauts and ß for robust matching
  const uml = x
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

  // remove punctuation-ish
  return uml
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(hay: string, needles: string[]): string[] {
  const hits: string[] = [];
  for (const n of needles) {
    const nn = normalize(n);
    if (!nn) continue;
    if (hay.includes(nn)) hits.push(n);
  }
  return hits;
}

function regexHits(text: string, patterns: Array<{ name: string; re: RegExp }>): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    try {
      if (p.re.test(text)) hits.push(p.name);
    } catch {
      // ignore broken regex, deterministic behavior: no hit
    }
  }
  return hits;
}

// Weighting — keep simple, deterministic
const W = {
  strongText: 6,
  strongFilename: 4,
  strongRegex: 7,
  weakText: 2,
  weakFilename: 1,
  negativeText: 8,
  negativeFilename: 5,
};

// Confidence shaping
function toConfidence(score: number): number {
  // simple squashing: score 0..35 -> confidence 0..1
  const c = Math.max(0, Math.min(1, score / 28));
  return Number(c.toFixed(3));
}

// Conflict handling
function isConflict(top: DocTypeCandidate, second?: DocTypeCandidate): boolean {
  if (!second) return false;
  // if scores are too close, we refuse to “guess”
  const gap = top.confidence - second.confidence;
  return gap < 0.08;
}

function capWithoutText(conf: number): number {
  // Without text we cap confidence hard, because filename can be manipulated.
  return Math.min(conf, 0.7);
}

function capFilenameOnlyCandidate(c: DocTypeCandidate, hasText: boolean): DocTypeCandidate {
  if (hasText) return c;
  return { ...c, confidence: capWithoutText(c.confidence) };
}

/**
 * Main classifier:
 * - uses filename + mimeType + text (if available)
 * - deterministic, conservative, returns unknown if ambiguous
 */
export function classifyDocType(input: {
  text?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  isScanned?: boolean | null;
  pages?: number | null;
}): DocTypeResult {
  const rawText = typeof input.text === "string" ? input.text : "";
  const rawFilename = typeof input.filename === "string" ? input.filename : "";
  const rawMime = typeof input.mimeType === "string" ? input.mimeType : "";

  const textNorm = normalize(rawText);
  const fileNorm = normalize(rawFilename);
  const mimeNorm = normalize(rawMime);

  const hasText = textNorm.length >= 40; // cheap threshold
  const looksLikeImage =
    mimeNorm.includes("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(rawFilename);
  const isScanned = input.isScanned === true;

  // Special case: no text + scanned/image => scan_image (useful for policy gating)
  if (!hasText && (looksLikeImage || isScanned)) {
    return {
      docType: "scan_image",
      confidence: 0.85, // deterministic “we know it's image-like”
      candidates: [
        {
          docType: "scan_image",
          score: 999,
          confidence: 0.85,
          evidence: { filenameHits: [], textHits: [], regexHits: [], negativeHits: [] },
        },
      ],
      reason: "no_text_image_or_scanned",
    };
  }

  const RULES: RuleSet[] = buildRules();

  const candidates: DocTypeCandidate[] = RULES.map((r) => {
    const ev = {
      filenameHits: [
        ...includesAny(fileNorm, r.strongFilename),
        ...includesAny(fileNorm, r.weakFilename),
      ],
      textHits: [
        ...includesAny(textNorm, r.strongText),
        ...includesAny(textNorm, r.weakText),
      ],
      regexHits: regexHits(rawText, r.strongRegex),
      negativeHits: [
        ...includesAny(fileNorm, r.negativeFilename),
        ...includesAny(textNorm, r.negativeText),
      ],
    };

    let score = 0;
    // Strong
    score += includesAny(textNorm, r.strongText).length * W.strongText;
    score += includesAny(fileNorm, r.strongFilename).length * W.strongFilename;
    score += regexHits(rawText, r.strongRegex).length * W.strongRegex;

    // Weak
    score += includesAny(textNorm, r.weakText).length * W.weakText;
    score += includesAny(fileNorm, r.weakFilename).length * W.weakFilename;

    // Negative (penalty)
    score -= includesAny(textNorm, r.negativeText).length * W.negativeText;
    score -= includesAny(fileNorm, r.negativeFilename).length * W.negativeFilename;

    const conf = toConfidence(score);

    const c: DocTypeCandidate = {
      docType: r.docType,
      score,
      confidence: conf,
      evidence: ev,
    };

    return capFilenameOnlyCandidate(c, hasText);
  })
    .filter((c) => c.docType !== "unknown") // unknown handled after scoring
    .sort((a, b) => b.confidence - a.confidence);

  const top = candidates[0];
  const second = candidates[1];

  // Conservative thresholds
  const MIN_CONF = hasText ? 0.52 : 0.45; // with no text we allow lower but capped anyway
  const topOk = top && top.confidence >= MIN_CONF;

  if (!top || !topOk) {
    return {
      docType: "unknown",
      confidence: 0.0,
      candidates: candidates.slice(0, 5),
      reason: top ? "no_candidate_reached_threshold" : "no_candidates",
    };
  }

  // If ambiguous, return unknown
  if (isConflict(top, second)) {
    return {
      docType: "unknown",
      confidence: Math.max(0.1, top.confidence - 0.15),
      candidates: candidates.slice(0, 5),
      reason: "ambiguous_top_candidates",
    };
  }

  // If negatives dominate, also fall back to unknown
  const negCount = top.evidence.negativeHits.length;
  if (negCount >= 2 && top.confidence < 0.75) {
    return {
      docType: "unknown",
      confidence: Math.max(0.1, top.confidence - 0.2),
      candidates: candidates.slice(0, 5),
      reason: "negative_signals_present",
    };
  }

  return {
    docType: top.docType,
    confidence: top.confidence,
    candidates: candidates.slice(0, 5),
    reason: "top_candidate_selected",
  };
}

/**
 * Rule sets — BIG, but structured.
 * IMPORTANT:
 * - strongText should contain “highly indicative phrases”
 * - weakText are common words; they should never win alone
 * - negative prevents false positives
 */
function buildRules(): RuleSet[] {
  return [
    // ----------------------------
    // Rental contract
    // ----------------------------
    {
      docType: "rental_contract",
      strongText: [
        "mietvertrag",
        "wohnraummietvertrag",
        "gewerbemietvertrag",
        "mietbeginn",
        "mietdauer",
        "mietsache",
        "vermieter",
        "mieter",
        "kaution",
        "schoenheitsreparaturen",
        "betriebskosten",
        "mieterhoehung",
        "sondervereinbarung",
      ],
      strongFilename: [
        "mietvertrag",
        "wohnraummietvertrag",
        "gewerbemietvertrag",
        "untermietvertrag",
        "mv",
        "mietv",
      ],
      strongRegex: [
        { name: "paragraph_sections", re: /(^|\n)\s*§\s*\d+/m },
        { name: "vermieter_mieter_block", re: /\bVermieter\b[\s\S]{0,400}\bMieter\b/i },
        { name: "kaution_amount", re: /\bKaution\b[\s\S]{0,60}(\d[\d\s\.]*)(?:,(\d{1,2}))?\s*(€|EUR)/i },
      ],
      weakText: ["anlage", "vereinbarung", "vertrag", "paragraph", "wohnflaeche", "kuendigung"],
      weakFilename: ["vertrag", "contract"],
      negativeText: [
        "rechnung",
        "rechnungsnummer",
        "bescheid",
        "urteil",
        "kontoauszug",
        "saldo",
        "mahnung",
      ],
      negativeFilename: ["rechnung", "rg", "invoice", "bescheid", "urteil", "kontoauszug"],
    },

    // ----------------------------
    // Rental addendum
    // ----------------------------
    {
      docType: "rental_addendum",
      strongText: [
        "nachtrag zum mietvertrag",
        "ergaenzung zum mietvertrag",
        "aenderungsvereinbarung",
        "zusatzvereinbarung",
        "wird wie folgt geaendert",
        "tritt an die stelle",
        "ersetzt",
      ],
      strongFilename: ["nachtrag", "ergaenzung", "aenderung", "addendum", "amendment"],
      strongRegex: [
        { name: "nachtrag_mietvertrag", re: /\bNachtrag\b[\s\S]{0,120}\bMietvertrag\b/i },
        { name: "wird_geaendert", re: /\bwird\s+wie\s+folgt\s+ge(ä|ae)ndert\b/i },
      ],
      weakText: ["vereinbarung", "anlage", "zusatz", "vertrag"],
      weakFilename: ["zusatz", "vereinbarung"],
      negativeText: ["rechnung", "urteil", "bescheid"],
      negativeFilename: ["rechnung", "urteil", "bescheid"],
    },

    // ----------------------------
    // Handover protocol
    // ----------------------------
    {
      docType: "handover_protocol",
      strongText: ["uebergabeprotokoll", "wohnungsuebergabe", "abnahme", "zaehlerstand", "schluessel", "maengel", "zustand"],
      strongFilename: ["uebergabeprotokoll", "abnahme", "uebergabe", "wohnungsuebergabe"],
      strongRegex: [
        { name: "zaehlerstand", re: /\b(Z(ä|ae)hlerstand|Stromz(ä|ae)hler|Gasz(ä|ae)hler|Wasserz(ä|ae)hler)\b/i },
        { name: "schluessel", re: /\b(Anzahl\s+Schl(ü|ue)ssel|Schl(ü|ue)ssel)\b/i },
      ],
      weakText: ["raum", "wand", "boden", "fenster", "tuer"],
      weakFilename: ["protokoll"],
      negativeText: ["rechnungsnummer", "mwst", "tenor", "entscheidungsgruende"],
      negativeFilename: ["rechnung", "urteil"],
    },

    // ----------------------------
    // Termination notice
    // ----------------------------
    {
      docType: "termination_notice",
      strongText: ["hiermit kuendige", "fristgerecht", "kuendigung", "beendigung des mietverhaeltnisses", "kuendigungsfrist", "zum"],
      strongFilename: ["kuendigung", "kündigung", "termination", "cancel"],
      strongRegex: [
        { name: "hiermit_kuendige", re: /\bhiermit\s+k(ü|ue)ndig/i },
        { name: "zum_date", re: /\bzum\s+\d{1,2}\.\d{1,2}\.\d{2,4}\b/ },
      ],
      weakText: ["mietverhaeltnis", "frist", "beendigung"],
      weakFilename: ["beendigung"],
      negativeText: ["rechnung", "rechnungsnummer", "abrechnungszeitraum", "tenor"],
      negativeFilename: ["rechnung", "abrechnung", "urteil"],
    },

    // ----------------------------
    // Rent increase notice
    // ----------------------------
    {
      docType: "rent_increase_notice",
      strongText: ["mieterhoehung", "mieterhöhung", "kappungsgrenze", "vergleichsmiete", "mietspiegel", "zustimmung", "§ 558", "558 bgb"],
      strongFilename: ["mieterhoehung", "mieterhöhung", "erhoehung", "kappungsgrenze", "mietspiegel"],
      strongRegex: [
        { name: "bgb_558", re: /§\s*558\b/i },
        { name: "zustimmung_mieterhoehung", re: /\bZustimmung\b[\s\S]{0,80}\bMieterh(ö|oe)hung\b/i },
      ],
      weakText: ["kaltmiete", "ab dem", "erhoehung", "gesetzlich"],
      weakFilename: ["erhoehung", "anpassung"],
      negativeText: ["abrechnungszeitraum", "verteilerschluessel", "rechnungsnummer", "tenor"],
      negativeFilename: ["abrechnung", "rechnung", "urteil"],
    },

    // ----------------------------
    // Operating cost statement (Nebenkosten/BK)
    // ----------------------------
    {
      docType: "operating_cost_statement",
      strongText: ["betriebskostenabrechnung", "nebenkostenabrechnung", "abrechnungszeitraum", "verteilerschluessel", "umlage", "nachzahlung", "guthaben", "heizkosten"],
      strongFilename: ["betriebskosten", "nebenkosten", "bk abrechnung", "heizkostenabrechnung", "jahresabrechnung"],
      strongRegex: [
        { name: "abrechnungszeitraum", re: /\bAbrechnungszeitraum\b/i },
        { name: "guthaben_nachzahlung", re: /\b(Guthaben|Nachzahlung)\b/i },
      ],
      weakText: ["grundsteuer", "hausmeister", "muell", "wasser", "warmwasser", "reinigung"],
      weakFilename: ["abrechnung"],
      negativeText: ["rechnungsnummer", "leistungsdatum", "im namen des volkes"],
      negativeFilename: ["urteil", "rechnung nr"],
    },

    // ----------------------------
    // Invoice
    // ----------------------------
    {
      docType: "invoice",
      strongText: ["rechnung", "rechnungsnummer", "leistungsdatum", "zahlungsziel", "netto", "brutto", "mwst", "ust", "iban", "bic"],
      strongFilename: ["rechnung", "invoice", "rg", "rnr", "bill", "faktura"],
      strongRegex: [
        { name: "iban", re: /\bIBAN\b\s*[A-Z]{2}\d{2}/i },
        { name: "rechnungsnummer", re: /\bRechnungs(?:nr|nummer)\b/i },
        { name: "netto_brutto", re: /\b(Netto|Brutto)\b[\s\S]{0,60}(€|EUR)/i },
      ],
      weakText: ["summe", "betrag", "steuer", "zahlbar"],
      weakFilename: ["rg", "rechnung"],
      negativeText: ["abrechnungszeitraum", "verteilerschluessel", "tenor", "tatbestand"],
      negativeFilename: ["urteil", "bescheid", "kontoauszug"],
    },

    // ----------------------------
    // Receipt
    // ----------------------------
    {
      docType: "receipt",
      strongText: ["quittung", "bar bezahlt", "bezahlt am", "kassenbon", "summe eur", "mwst"],
      strongFilename: ["quittung", "receipt", "bon", "kassenbon"],
      strongRegex: [
        { name: "bar_bezahlt", re: /\bbar\s+bezahlt\b/i },
      ],
      weakText: ["kasse", "betrag", "eur"],
      weakFilename: ["bon"],
      negativeText: ["rechnungsnummer", "iban", "tenor"],
      negativeFilename: ["urteil", "bescheid"],
    },

    // ----------------------------
    // Bank statement
    // ----------------------------
    {
      docType: "bank_statement",
      strongText: ["kontoauszug", "buchungstag", "valuta", "saldo", "kontostand", "umsatz", "iban"],
      strongFilename: ["kontoauszug", "statement", "umsaetze", "kontobewegungen"],
      strongRegex: [
        { name: "saldo", re: /\bSaldo\b/i },
        { name: "valuta", re: /\bValuta\b/i },
      ],
      weakText: ["gutschrift", "lastschrift", "verwendungszweck"],
      weakFilename: ["auszug"],
      negativeText: ["rechnungsnummer", "tenor", "abrechnungszeitraum"],
      negativeFilename: ["urteil", "bescheid"],
    },

    // ----------------------------
    // Dunning / reminder
    // ----------------------------
    {
      docType: "reminder_dunning",
      strongText: ["mahnung", "zahlungserinnerung", "offener betrag", "letzte frist", "verzug", "mahngebuehr"],
      strongFilename: ["mahnung", "erinnerung", "dunning"],
      strongRegex: [
        { name: "offener_betrag", re: /\boffen(?:er|e|es)?\s+Betrag\b/i },
      ],
      weakText: ["bitte ueberweisen", "frist", "zahlung"],
      weakFilename: ["frist"],
      negativeText: ["im namen des volkes", "tenor", "kontoauszug"],
      negativeFilename: ["urteil", "kontoauszug"],
    },

    // ----------------------------
    // Court decision / order
    // ----------------------------
    {
      docType: "court_decision",
      strongText: ["im namen des volkes", "urteil", "tenor", "tatbestand", "entscheidungsgruende", "aktenzeichen", "kosten des verfahrens"],
      strongFilename: ["urteil", "gericht", "az", "aktenzeichen"],
      strongRegex: [
        { name: "az", re: /\bAz\.\s*[:\-\s]?\s*[0-9A-Za-z\/\.\-]+\b/i },
        { name: "tenor_block", re: /\bTenor\b[\s\S]{0,400}\b/i },
      ],
      weakText: ["kammer", "verhandlung", "beschwerde"],
      weakFilename: ["gericht"],
      negativeText: ["rechnungsnummer", "iban", "abrechnungszeitraum"],
      negativeFilename: ["rechnung", "kontoauszug"],
    },
    {
      docType: "court_order",
      strongText: ["beschluss", "gericht", "aktenzeichen", "kostenentscheidung", "sofortige beschwerde"],
      strongFilename: ["beschluss", "gericht", "aktenzeichen"],
      strongRegex: [
        { name: "az", re: /\bAz\.\s*[:\-\s]?\s*[0-9A-Za-z\/\.\-]+\b/i },
      ],
      weakText: ["verfuegung", "anordnung"],
      weakFilename: ["anordnung"],
      negativeText: ["rechnungsnummer", "iban"],
      negativeFilename: ["rechnung"],
    },

    // ----------------------------
    // Legal letter
    // ----------------------------
    {
      docType: "legal_letter",
      strongText: ["rechtsanwalt", "kanzlei", "in vorbezeichneter angelegenheit", "wir vertreten", "fristsetzung", "ohne anerkennung einer rechtspflicht"],
      strongFilename: ["anwalt", "kanzlei", "ra"],
      strongRegex: [
        { name: "in_angelegenheit", re: /\bin\s+vorbezeichneter\s+Angelegenheit\b/i },
      ],
      weakText: ["forderung", "frist", "stellungnahme"],
      weakFilename: ["anwalt"],
      negativeText: ["im namen des volkes", "tenor"],
      negativeFilename: ["urteil", "beschluss"],
    },

    // ----------------------------
    // Authority letter / tax assessment
    // ----------------------------
    {
      docType: "tax_assessment",
      strongText: ["steuerbescheid", "finanzamt", "festgesetzt", "rechtsbehelfsbelehrung", "einspruch", "steuernummer"],
      strongFilename: ["steuerbescheid", "finanzamt", "bescheid"],
      strongRegex: [
        { name: "rechtsbehelfsbelehrung", re: /\bRechtsbehelfsbelehrung\b/i },
      ],
      weakText: ["bescheid", "festsetzung", "betrag"],
      weakFilename: ["bescheid"],
      negativeText: ["rechnungsnummer", "iban"],
      negativeFilename: ["rechnung"],
    },
    {
      docType: "authority_letter",
      strongText: ["bescheid", "behorde", "amt", "rechtsbehelfsbelehrung", "frist", "aktenzeichen"],
      strongFilename: ["bescheid", "amt", "behoerde"],
      strongRegex: [],
      weakText: ["antrag", "formular", "verfuegung"],
      weakFilename: ["amt"],
      negativeText: ["rechnung", "im namen des volkes"],
      negativeFilename: ["rechnung", "urteil"],
    },

    // ----------------------------
    // Insurance policy
    // ----------------------------
    {
      docType: "insurance_policy",
      strongText: ["versicherungsschein", "police", "versicherungsnehmer", "versicherungsbeginn", "beitrag", "deckung", "selbstbeteiligung"],
      strongFilename: ["versicherung", "police", "beitrag"],
      strongRegex: [
        { name: "versicherungsschein", re: /\bVersicherungsschein\b/i },
      ],
      weakText: ["laufzeit", "bedingungen"],
      weakFilename: ["versicherung"],
      negativeText: ["rechnungsnummer", "tenor"],
      negativeFilename: ["urteil", "rechnung"],
    },

    // ----------------------------
    // Email/Letter/Report/Form — generic fallback types
    // ----------------------------
    {
      docType: "email_printout",
      strongText: ["von:", "an:", "betreff:", "gesendet:", "cc:", "bcc:"],
      strongFilename: ["email", "e-mail", "mail"],
      strongRegex: [
        { name: "mail_headers", re: /(^|\n)\s*(Von|An|Betreff|Gesendet)\s*:\s*/i },
      ],
      weakText: ["freundliche gruesse", "mit freundlichen gruessen"],
      weakFilename: ["mail"],
      negativeText: ["rechnungsnummer", "im namen des volkes"],
      negativeFilename: ["rechnung", "urteil"],
    },
    {
      docType: "official_form",
      strongText: ["bitte ausfuellen", "unterschrift", "datum", "feld", "formular", "antrag"],
      strongFilename: ["formular", "antrag", "vordruck", "formblatt"],
      strongRegex: [],
      weakText: ["angaben", "hinweise", "pflichtfeld"],
      weakFilename: ["antrag"],
      negativeText: ["rechnungsnummer", "tenor"],
      negativeFilename: ["urteil"],
    },
    {
      docType: "letter",
      strongText: ["mit freundlichen gruessen", "sehr geehrte", "anschrift", "datum"],
      strongFilename: ["schreiben", "brief", "letter"],
      strongRegex: [
        { name: "salutation", re: /\bSehr\s+geehrte\b/i },
        { name: "closing", re: /\bMit\s+freundlichen\s+Gr(ü|ue)(ß|ss)en\b/i },
      ],
      weakText: ["bezug", "anbei", "rueckfragen"],
      weakFilename: ["brief"],
      negativeText: ["rechnungsnummer", "iban", "tenor", "abrechnungszeitraum"],
      negativeFilename: ["rechnung", "urteil", "abrechnung"],
    },
    {
      docType: "report",
      strongText: ["bericht", "zusammenfassung", "analyse", "ergebnis", "fazit"],
      strongFilename: ["bericht", "report", "analysis"],
      strongRegex: [],
      weakText: ["kapitel", "abschnitt"],
      weakFilename: ["report"],
      negativeText: ["rechnungsnummer", "im namen des volkes"],
      negativeFilename: ["rechnung", "urteil"],
    },

    // NOTE: utility_bill, repair_offer, repair_invoice can be added next
    // once you want more granularity. Keeping 3.1 lean-enough for now.
  ];
}