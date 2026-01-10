// functions/src/core/satellites/document-understanding/understanding/signals.ts
// Phase 3.3 — Signals extraction (deterministic, conservative, local-cheap)
//
// Goal: extract "signals" (not facts!) from text that are useful for later modules.
// HARD RULES:
// - No guessing. If ambiguous => do not emit.
// - Keep output bounded.
// - Deterministic regex + heuristics only.

export type MoneySignalKind = "rent_cold" | "rent_warm" | "operating_costs" | "deposit" | "amount_generic";
export type PartyRole = "landlord" | "tenant" | "unknown";
export type DeadlineKind = "termination_date" | "payment_due" | "response_deadline" | "general_date";

export type PartySignal = {
  role: PartyRole;
  name: string;              // cleaned
  confidence: number;        // 0..1
  evidence: { pattern: string; snippet: string };
};

export type MoneySignal = {
  kind: MoneySignalKind;
  amountEur: number;         // normalized float (e.g. 1000.0)
  raw: string;               // raw matched token
  confidence: number;        // 0..1
  evidence: { pattern: string; snippet: string };
};

export type DeadlineSignal = {
  kind: DeadlineKind;
  dateISO: string;           // YYYY-MM-DD
  raw: string;
  confidence: number;        // 0..1
  evidence: { pattern: string; snippet: string };
};

export type ObjectSignal = {
  kind: "address" | "postcode_city" | "unit_hint";
  value: string;
  confidence: number;        // 0..1
  evidence: { pattern: string; snippet: string };
};

export type SignalsResult =
  | {
      ok: true;
      confidence: number; // overall
      parties: PartySignal[];
      money: MoneySignal[];
      deadlines: DeadlineSignal[];
      objectRefs: ObjectSignal[];
      stats: {
        hasText: boolean;
        textChars: number;
        scannedLike: boolean;
        moneyCount: number;
        dateCount: number;
        partyCount: number;
        objectCount: number;
      };
      reason: string;
    }
  | {
      ok: false;
      confidence: number;
      parties: PartySignal[];
      money: MoneySignal[];
      deadlines: DeadlineSignal[];
      objectRefs: ObjectSignal[];
      stats: {
        hasText: boolean;
        textChars: number;
        scannedLike: boolean;
        moneyCount: number;
        dateCount: number;
        partyCount: number;
        objectCount: number;
      };
      reason: string;
    };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeSpaces(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function snippetAround(text: string, idx: number, len = 120): string {
  const start = Math.max(0, idx - Math.floor(len / 2));
  const end = Math.min(text.length, start + len);
  return normalizeSpaces(text.slice(start, end));
}

function toISODate(day: number, month: number, year: number): string | null {
  if (year < 100) year = year + 2000; // 24 -> 2024 (deterministic assumption)
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseEuroAmount(raw: string): number | null {
  // Accept "1.000,50", "1000,50", "1 000,50", "1000", "1.000"
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // remove currency words/symbols
  const cleaned = s
    .replace(/€/g, "")
    .replace(/\b(eur|euro)\b/gi, "")
    .replace(/\s/g, "");

  // if has both "." and "," we assume "." thousands and "," decimals (DE)
  // if only "," => decimals
  // if only "." => could be thousands or decimals; we treat "." as thousands if 3-digit groups exist
  let normalized = cleaned;

  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    normalized = normalized.replace(",", ".");
  } else if (!hasComma && hasDot) {
    // heuristic: if dot used as thousands (1.234.567) => remove all dots
    if (/^\d{1,3}(\.\d{3})+(\.\d+)?$/.test(normalized)) {
      normalized = normalized.replace(/\./g, "");
    }
    // else keep as decimal dot
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;

  // sanity bounds (super conservative)
  if (n > 5_000_000) return null;

  // round to cents
  return Math.round(n * 100) / 100;
}

function looksScannedLike(text: string): boolean {
  // very crude: lots of single letters, broken words, or extremely low word length
  const t = String(text ?? "");
  if (t.length < 200) return false;
  const weird = (t.match(/\b\w\b/g) ?? []).length; // single-char tokens
  const words = (t.match(/\b\w+\b/g) ?? []).length;
  if (words === 0) return false;
  return weird / words > 0.25;
}

/**
 * MAIN: extract signals from text.
 * Conservative: only emit when pattern is strong.
 */
export function extractSignals(input: {
  text?: string | null;
  filename?: string | null;
  mimeType?: string | null;
}): SignalsResult {
  const rawText = typeof input.text === "string" ? input.text : "";
  const text = rawText; // keep original for snippets
  const textChars = text.length;
  const hasText = normalizeSpaces(text).length >= 80; // require more than structure classifier
  const scannedLike = looksScannedLike(text);

  const stats = {
    hasText,
    textChars,
    scannedLike,
    moneyCount: 0,
    dateCount: 0,
    partyCount: 0,
    objectCount: 0,
  };

  const emptyOut = (): SignalsResult => ({
    ok: false,
    confidence: 0,
    parties: [],
    money: [],
    deadlines: [],
    objectRefs: [],
    stats,
    reason: hasText ? "no_strong_signals" : "no_text_or_too_short",
  });

  if (!hasText) return emptyOut();

  // -----------------------------
  // MONEY SIGNALS
  // -----------------------------
  const money: MoneySignal[] = [];

  // Strong anchored patterns (German, conservative)
  const MONEY_RULES: Array<{
    kind: MoneySignalKind;
    patternName: string;
    re: RegExp;
    baseConf: number;
  }> = [
    {
      kind: "rent_cold",
      patternName: "rent_cold_kaltmiete",
      re: /\b(kaltmiete)\b[\s\S]{0,40}?\b(\d[\d\.\s]*)(?:,(\d{1,2}))?\s*(€|eur|euro)\b/gi,
      baseConf: 0.86,
    },
    {
      kind: "operating_costs",
      patternName: "operating_costs_nebenkosten",
      re: /\b(nebenkosten|betriebskosten(?:vorauszahlung)?)\b[\s\S]{0,40}?\b(\d[\d\.\s]*)(?:,(\d{1,2}))?\s*(€|eur|euro)\b/gi,
      baseConf: 0.82,
    },
    {
      kind: "rent_warm",
      patternName: "rent_warm_warmmiete",
      re: /\b(warmmiete|gesamtmiete|bruttomiete)\b[\s\S]{0,40}?\b(\d[\d\.\s]*)(?:,(\d{1,2}))?\s*(€|eur|euro)\b/gi,
      baseConf: 0.82,
    },
    {
      kind: "deposit",
      patternName: "deposit_kaution",
      re: /\b(kaution|mietsicherheit)\b[\s\S]{0,60}?\b(\d[\d\.\s]*)(?:,(\d{1,2}))?\s*(€|eur|euro)\b/gi,
      baseConf: 0.78,
    },
  ];

  for (const rule of MONEY_RULES) {
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const rawAmount = `${m[2]}${m[3] ? "," + m[3] : ""}`;
      const amountEur = parseEuroAmount(rawAmount);
      if (amountEur == null) continue;

      const idx = m.index ?? 0;
      const snip = snippetAround(text, idx);

      // sanity: typical monthly rent bounds (still allow wide range)
      let conf = rule.baseConf;
      if (rule.kind === "rent_cold" || rule.kind === "rent_warm") {
        if (amountEur < 100 || amountEur > 50_000) conf -= 0.25;
      }

      money.push({
        kind: rule.kind,
        amountEur,
        raw: normalizeSpaces(m[0]),
        confidence: Number(clamp01(conf).toFixed(3)),
        evidence: { pattern: rule.patternName, snippet: snip },
      });

      if (money.length >= 20) break; // bound
    }
    if (money.length >= 20) break;
  }

  // Deduplicate money signals of same kind (keep highest confidence)
  const moneyByKind = new Map<MoneySignalKind, MoneySignal>();
  for (const s of money) {
    const prev = moneyByKind.get(s.kind);
    if (!prev || s.confidence > prev.confidence) moneyByKind.set(s.kind, s);
  }
  const moneyOut = Array.from(moneyByKind.values()).sort((a, b) => b.confidence - a.confidence);

  // -----------------------------
  // DEADLINE / DATE SIGNALS
  // -----------------------------
  const deadlines: DeadlineSignal[] = [];

  // Strong patterns: "frist bis", "spätestens bis", "zum <date>", "bis zum <date>"
  const DATE_RULES: Array<{
    kind: DeadlineKind;
    patternName: string;
    re: RegExp;
    baseConf: number;
  }> = [
    {
      kind: "response_deadline",
      patternName: "frist_bis",
      re: /\b(frist|spätestens|spaetestens)\b[\s\S]{0,30}?\b(bis(?:\s+zum)?)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/gi,
      baseConf: 0.78,
    },
    {
      kind: "termination_date",
      patternName: "kuendigung_zum",
      re: /\b(kündigung|kuendigung|beendigung)\b[\s\S]{0,60}?\b(zum)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/gi,
      baseConf: 0.80,
    },
    {
      kind: "payment_due",
      patternName: "zahlbar_bis",
      re: /\b(zahlbar|zahlung)\b[\s\S]{0,40}?\b(bis(?:\s+zum)?)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/gi,
      baseConf: 0.74,
    },
    {
      kind: "general_date",
      patternName: "zum_date_generic",
      re: /\b(zum|ab\s+dem|ab)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/gi,
      baseConf: 0.60,
    },
  ];

  for (const rule of DATE_RULES) {
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      // index positions depend on rule. We unify by taking last 3 capture groups as D/M/Y.
      const day = Number(m[m.length - 3]);
      const month = Number(m[m.length - 2]);
      const year = Number(m[m.length - 1]);
      const iso = toISODate(day, month, year);
      if (!iso) continue;

      const idx = m.index ?? 0;
      const snip = snippetAround(text, idx);

      deadlines.push({
        kind: rule.kind,
        dateISO: iso,
        raw: normalizeSpaces(m[0]),
        confidence: Number(clamp01(rule.baseConf).toFixed(3)),
        evidence: { pattern: rule.patternName, snippet: snip },
      });

      if (deadlines.length >= 20) break;
    }
    if (deadlines.length >= 20) break;
  }

  // Dedup: same ISO date + kind keep highest confidence
  const deadKey = (d: DeadlineSignal) => `${d.kind}:${d.dateISO}`;
  const dedDead = new Map<string, DeadlineSignal>();
  for (const d of deadlines) {
    const k = deadKey(d);
    const prev = dedDead.get(k);
    if (!prev || d.confidence > prev.confidence) dedDead.set(k, d);
  }
  const deadlinesOut = Array.from(dedDead.values()).sort((a, b) => b.confidence - a.confidence);

  // -----------------------------
  // PARTIES (Tenant/Landlord names) — VERY conservative
  // -----------------------------
  const parties: PartySignal[] = [];

  // We only extract names if we see a role label near a name-ish line.
  // Example patterns:
  // "Vermieter: Max Mustermann"
  // "Mieter: Erika Musterfrau"
  const PARTY_RULES: Array<{
    role: PartyRole;
    patternName: string;
    re: RegExp;
    baseConf: number;
  }> = [
    {
      role: "landlord",
      patternName: "vermieter_label",
      re: /\b(vermieter|eigentümer|eigentuemer)\s*[:\-]\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+){0,4})/g,
      baseConf: 0.76,
    },
    {
      role: "tenant",
      patternName: "mieter_label",
      re: /\b(mieter)\s*[:\-]\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+){0,4})/g,
      baseConf: 0.76,
    },
  ];

  function cleanName(s: string): string {
    return normalizeSpaces(String(s ?? ""))
      .replace(/\b(Herr|Frau|Mr|Mrs|Dr)\.?\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function looksLikeGoodName(s: string): boolean {
    const x = cleanName(s);
    if (!x) return false;
    if (x.length < 5) return false;
    // reject if contains typical doc words
    if (/\b(vertrag|rechnung|bescheid|datum|anlage|abschnitt|seite)\b/i.test(x)) return false;
    // reject if too many tokens
    const parts = x.split(" ");
    if (parts.length > 5) return false;
    // must contain at least 2 tokens (first+last name) to avoid noise
    if (parts.length < 2) return false;
    return true;
  }

  for (const rule of PARTY_RULES) {
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const nameRaw = m[2] ?? "";
      if (!looksLikeGoodName(nameRaw)) continue;

      const idx = m.index ?? 0;
      const snip = snippetAround(text, idx);

      parties.push({
        role: rule.role,
        name: cleanName(nameRaw),
        confidence: rule.baseConf,
        evidence: { pattern: rule.patternName, snippet: snip },
      });

      if (parties.length >= 6) break; // bound hard
    }
    if (parties.length >= 6) break;
  }

  // Dedup per role (keep highest confidence)
  const partyByRole = new Map<PartyRole, PartySignal>();
  for (const p of parties) {
    const prev = partyByRole.get(p.role);
    if (!prev || p.confidence > prev.confidence) partyByRole.set(p.role, p);
  }
  const partiesOut = Array.from(partyByRole.values()).sort((a, b) => b.confidence - a.confidence);

  // -----------------------------
  // OBJECT REFERENCES (Address / PLZ) — conservative
  // -----------------------------
  const objectRefs: ObjectSignal[] = [];

  // PLZ + City (Germany) - conservative: 5 digits + city words
  const rePlzCity = /\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+){0,3})\b/g;

  // Street address (very rough): "Musterstraße 12", "Musterstr. 12a"
  const reStreet = /\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?:straße|str\.|strasse|weg|allee|platz|ring|damm|ufer|gasse))\s+(\d{1,4}[a-zA-Z]?)\b/g;

  // Add only first few, avoid noise
  let m1: RegExpExecArray | null;
  while ((m1 = rePlzCity.exec(text)) !== null) {
    const val = `${m1[1]} ${normalizeSpaces(m1[2])}`;
    const idx = m1.index ?? 0;
    objectRefs.push({
      kind: "postcode_city",
      value: val,
      confidence: 0.66,
      evidence: { pattern: "plz_city", snippet: snippetAround(text, idx) },
    });
    if (objectRefs.length >= 6) break;
  }

  let m2: RegExpExecArray | null;
  while ((m2 = reStreet.exec(text)) !== null) {
    const val = `${normalizeSpaces(m2[1])} ${m2[2]}`;
    const idx = m2.index ?? 0;
    objectRefs.push({
      kind: "address",
      value: val,
      confidence: 0.62,
      evidence: { pattern: "street_number", snippet: snippetAround(text, idx) },
    });
    if (objectRefs.length >= 8) break;
  }

  // Dedup by value
  const objDed = new Map<string, ObjectSignal>();
  for (const o of objectRefs) {
    const k = `${o.kind}:${o.value.toLowerCase()}`;
    const prev = objDed.get(k);
    if (!prev || o.confidence > prev.confidence) objDed.set(k, o);
  }
  const objectOut = Array.from(objDed.values()).sort((a, b) => b.confidence - a.confidence);

  // -----------------------------
  // Overall confidence (simple, deterministic)
  // -----------------------------
  stats.moneyCount = moneyOut.length;
  stats.dateCount = deadlinesOut.length;
  stats.partyCount = partiesOut.length;
  stats.objectCount = objectOut.length;

  const signalStrength =
    (moneyOut.length > 0 ? 0.35 : 0) +
    (deadlinesOut.length > 0 ? 0.25 : 0) +
    (partiesOut.length > 0 ? 0.20 : 0) +
    (objectOut.length > 0 ? 0.12 : 0) +
    (scannedLike ? -0.10 : 0);

  const overall = Number(clamp01(0.35 + signalStrength).toFixed(3));

  const ok = moneyOut.length + deadlinesOut.length + partiesOut.length + objectOut.length > 0;

  return {
    ok,
    confidence: ok ? overall : 0.25,
    parties: partiesOut,
    money: moneyOut,
    deadlines: deadlinesOut,
    objectRefs: objectOut,
    stats,
    reason: ok ? "signals_extracted" : "no_strong_signals",
  };
}