// functions/src/domains/real_estate/extractors/real_estate.v1.ts

import { logger } from "firebase-functions/v2";
import type {
  Extractor,
  ExtractorInput,
  ExtractorResult,
  FactInput,
} from "../../../core/facts/types";
import { buildPropertyFingerprintV1 } from "../utils/fingerprint";
import {
  extractGermanPostcode,
  extractStreetAndHouseNumber,
  normalizeTextForParsing,
} from "../utils/parse";

export const realEstateV1Extractor: Extractor = {
  id: "real_estate.v1",
  domain: "real_estate",

  async extract(input: ExtractorInput): Promise<ExtractorResult> {
    const locale = input?.locale ?? "de-DE";
    const rawEventId = String(input?.rawEventId ?? "").trim();
    const text = String(input?.payload?.text ?? "");
    const normalizedText = normalizeTextForParsing(text);
    const postcode = extractGermanPostcode(normalizedText);
    const { street, houseNumber } = extractStreetAndHouseNumber(normalizedText);

    // --- Demo Parsing (erweitert) ---

// Gewerbe-/Laden-Einheit: viele mögliche Begriffe
// Gewerbe-/Laden-Einheit: viele mögliche Begriffe + Plural + typische Tippfehler
const COMMERCIAL_WORD = String.raw`(?:` +
  // Kernbegriffe (Singular-Stämme)
  String.raw`laden|ladn|ladden|shop|shoop|gewerbe|gewerb|gewerbeeinh(?:eit|ait|et)|` +
  String.raw`einzelhandel|einzelh(?:andel|ndel)|lokal|lokall|ladenlokal|` +
  String.raw`verkaufsfl(?:ae|a|ä)ch(?:e|n)|verkauf(?:sflaeche|sfäche|sflaeche)|` +
  String.raw`kiosk|kios|kioosk|` +
  String.raw`restaurant|restaura(?:nt|n)|resturant|restaurat|restaraunt|` +
  String.raw`cafe|café|kaffee|cafee|caffee|` +
  String.raw`bistro|bistor|` +
  String.raw`imbiss|immbiss|` +
  String.raw`bar|` +
  String.raw`praxis|praxs|` +
  String.raw`bu(?:e|ü)ro|buro|büro|buerro|` +
  String.raw`office|` +
  String.raw`atelier|atelie|` +
  String.raw`studio|stduio|` +
  String.raw`lager|lagerr|lagerraum|lagerra(?:um|m)|` +
  String.raw`halle|hallle|` +
  String.raw`werkstatt|werkstat|` +
  String.raw`stellplatz|stellpl(?:a|ä)tz(?:e|)|stelplatz|` +
  String.raw`garage|garag(?:e|n)|garaje|` +
  String.raw`tiefgarage|tiefgarag(?:e|en)|tg|tiefgaraje|` +
  // neue "zwölf" extra Begriffe (plus Schreibvarianten)
  String.raw`gewerbefl(?:ae|ä)che|gewerberaum|gewerber(?:ae|ä)ume|` +
  String.raw`verkauf|verkaufsraum|showroom|` +
  String.raw`lagerfl(?:ae|ä)che|` +
  String.raw`keller|kellerr|` +
  String.raw`abstellraum|abstelraum|` +
  String.raw`kfz-stellplatz|kfzstellplatz|` +
  String.raw`parkplatz|parkpl(?:a|ä)tz(?:e|)|` +
  String.raw`carport|car-port|` +
  String.raw`apotheke|apoteke|` +
  String.raw`s(?:pae|pä)ti|spati|späti|spätkauf|spaetkauf|spatkauf` +
`)` +
  // sehr wichtig: generische Plural-/Flexionsendungen für viele Wörter:
  String.raw`(?:e|en|er|n|s)?`;

// Word-boundaries (\b) sind bei "-" und Sonderzeichen oft unzuverlässig.
// Deshalb: eigene "Grenzen" definieren (Start oder Trenner) + (Ende oder Trenner).
const COMMERCIAL_RE = new RegExp(
  String.raw`(?:^|[\s,;:()\[\]{}"'.!?/\\\-])(?:${COMMERCIAL_WORD})(?=$|[\s,;:()\[\]{}"'.!?/\\\-])`,
  "i"
);

// =====================================================
// Helpers: Wortzahlen + Tippfehler → Integer
// =====================================================

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function wordNumberToInt(token: string): number | null {
  const t = normalizeToken(token);

  const map: Record<string, number> = {
    // 1
    ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eins: 1, ain: 1, eim: 1,
    // 2
    zwei: 2, zwo: 2, zweii: 2, zwai: 2,
    // 3
    drei: 3, dreii: 3, dreie: 3, drie: 3,
    // 4
    vier: 4, vire: 4, vierr: 4,
    // 5
    fünf: 5, funf: 5, fuenf: 5, fuf: 5, fuff: 5,
    // 6
    sechs: 6, sech: 6, sechss: 6, sex: 6,
    // 7
    sieben: 7, sibn: 7, siebn: 7,
    // 8
    acht: 8, ach: 8, achtt: 8,
    // 9
    neun: 9, neu: 9, neunn: 9,
    // 10
    zehn: 10, zehen: 10, zehnn: 10,
    // 11
    elf: 11, ellf: 11,
    // 12
    zwölf: 12, zwolf: 12, zwoelf: 12, zwölff: 12,
  };

  return map[t] ?? null;
}

function parseCountToken(raw: string): number | null {
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  return wordNumberToInt(raw);
}

// Zentrale Tokenliste für Regex
const WORD_NUM_TOKEN = String.raw`(?:[0-9]{1,3}|ein|eine|einen|einem|einer|eins|ain|eim|zwei|zwo|zweii|zwai|drei|dreii|dreie|drie|vier|vire|vierr|fünf|funf|fuenf|fuf|fuff|sechs|sech|sechss|sex|sieben|sibn|siebn|acht|ach|achtt|neun|neu|neunn|zehn|zehen|zehnn|elf|ellf|zwölf|zwolf|zwoelf|zwölff)`;

// true/false bleibt praktisch für schnelle Checks
const hasCommercialUnit = COMMERCIAL_RE.test(normalizedText);

// Zählt z.B.:
// "2 Garagen", "1 Stellplatz", "3 Lager", "2 Gewerbeeinheiten", "4 Shops"
function countCommercialUnits(text: string): number {
  // A) Zahl direkt VOR einem Gewerbe-Wort: "2 garagen", "3 lager"
  const reBefore = new RegExp(
  String.raw`(?:^|\s)(${WORD_NUM_TOKEN})\s*(?:x\s*)?\b(${COMMERCIAL_WORD})\b`,
  "gi"
);

let sum = 0;
for (const m of text.matchAll(reBefore)) {
  const n = parseCountToken(String(m?.[1] ?? "").trim());
  if (typeof n === "number" && Number.isFinite(n) && n > 0) sum += n;
}

  // B) Fallback: wenn nur erwähnt ("… mit Garage"), aber keine Zahl -> 1
  if (sum === 0 && COMMERCIAL_RE.test(text)) return 1;

  return sum;
}

const commercialUnitsCount = countCommercialUnits(normalizedText);

const hasColdRent =
  /kaltmiete/i.test(normalizedText) || /\bkalt\b/i.test(normalizedText);

  const MONEY = String.raw`(?:€|eur|euro|euros|e|\u20AC)`;

function matchNumber(re: RegExp): number | null {
  const m = normalizedText.match(re);
  if (!m) return null;

  // 1) Bevorzugt erste Capture-Group, sonst gesamter Match
  const raw = String(m[1] ?? m[0] ?? "").trim();
  if (!raw) return null;

  // 2) Alles rauswerfen außer Ziffern, Punkt, Komma (damit "900euro", "900 €" etc. geht)
  //    Beispiele:
  //    "7.000" -> "7.000"
  //    "7,000" -> "7,000"
  //    "7000euro" -> "7000"
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  // 3) Tausendertrenner/Dezimal sauber machen:
  //    - Wenn beides vorkommt: letzte Trennstelle gilt als Dezimal, der Rest Tausender
  //    - Sonst: alle Punkte/Kommas als Tausendertrenner entfernen
  let normalized = cleaned;

  const hasDot = normalized.includes(".");
  const hasComma = normalized.includes(",");

  if (hasDot && hasComma) {
    const lastDot = normalized.lastIndexOf(".");
    const lastComma = normalized.lastIndexOf(",");
    const decPos = Math.max(lastDot, lastComma);
    const decChar = normalized[decPos];

    const intPart = normalized.slice(0, decPos).replace(/[.,]/g, "");
    const fracPart = normalized.slice(decPos + 1).replace(/[.,]/g, "");
    normalized = intPart + "." + fracPart; // Dezimal immer als Punkt
  } else {
    // Keine Dezimal-Angaben erwartet -> alles als Tausendertrenner behandeln
    normalized = normalized.replace(/[.,]/g, "");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// A) Einzelwert "Kaltmiete: 900" oder "900 €" oder "900euro"
const coldRentSingle =
  matchNumber(
    new RegExp(
      String.raw`kaltmiete\s*[:\-]?\s*([0-9]{2,7}(?:[.,][0-9]{3})*)(?:\s*${MONEY})?`,
      "i"
    )
  ) ??
  matchNumber(
    new RegExp(
      String.raw`([0-9]{2,7}(?:[.,][0-9]{3})*)\s*${MONEY}\b`,
      "i"
    )
  );

// B) "500 euro kalt" / "500kalt" / "500 € kalt"
const coldRentPerUnit =
  matchNumber(
    new RegExp(
      String.raw`([0-9]{2,7}(?:[.,][0-9]{3})*)\s*(?:${MONEY})?\s*kalt\b`,
      "i"
    )
  );

// C) "200 euro nebenkosten" / "200 nebenkosten"
const nkPerUnit =
  matchNumber(
    new RegExp(
      String.raw`([0-9]{1,7}(?:[.,][0-9]{3})*)\s*(?:${MONEY})?\s*nebenkosten\b`,
      "i"
    )
  );

  // D) "2 wohnungen" / "2 whg" / "2 wohn-einheiten"
const RESIDENTIAL_WORD = String.raw`(?:wohnungen|whg\.?|wohneinheiten|wohneinheit|wohneinheiten|wohnung|wohneinheit)`;

// "2 wohnungen" / "zwei wohnungen" / "zwai whg" / "ein wohneinheit"
const unitsCount = (() => {
  const re = new RegExp(
  String.raw`(?:^|[\s,;:()\[\]-])(${WORD_NUM_TOKEN})\s*(?:x\s*)?(?:${RESIDENTIAL_WORD})(?=$|[\s,;:()\[\].-])`,
  "i"
);
  const m = normalizedText.match(re);
  if (!m) return null;
  const n = parseCountToken(String(m[1] ?? "").trim());
  return typeof n === "number" && Number.isFinite(n) ? n : null;
})();

// Gesamt-Einheiten = Wohnungen + (1 falls Gewerbe-Einheit erwähnt wird)
const unitsTotal =
  unitsCount !== null
    ? unitsCount + commercialUnitsCount
    : commercialUnitsCount > 0
      ? commercialUnitsCount
      : null;

// E) Laden/Shop: "laden ... 7000 euro kaltmiete" / "laden ... 7000 euro kalt"
const shopColdRent =
  matchNumber(
    new RegExp(
      String.raw`(?:${COMMERCIAL_WORD})[^0-9]{0,80}([0-9]{2,7}(?:[.,][0-9]{3})*)\s*(?:${MONEY})?\s*kaltmiete\b`,
      "i"
    )
  ) ??
  matchNumber(
    new RegExp(
      String.raw`(?:${COMMERCIAL_WORD})[^0-9]{0,80}([0-9]{2,7}(?:[.,][0-9]{3})*)\s*(?:${MONEY})?\s*kalt\b`,
      "i"
    )
  );

// Laden-NK: "... nebenkosten 400 euro" oder "... 400 euro nebenkosten"
const shopNk =
  matchNumber(
    new RegExp(
      String.raw`(?:${COMMERCIAL_WORD})[^0-9]{0,80}[^\n\r]{0,120}nebenkosten[^0-9]{0,20}([0-9]{1,7}(?:[.,][0-9]{3})*)\b`,
      "i"
    )
  ) ??
  matchNumber(
    new RegExp(
      String.raw`(?:${COMMERCIAL_WORD})[^0-9]{0,80}[^\n\r]{0,120}([0-9]{1,7}(?:[.,][0-9]{3})*)\s*(?:${MONEY})?\s*nebenkosten\b`,
      "i"
    )
  );

// Für propertyFacts nutzen wir bevorzugt per-unit kalt, sonst single
const coldRent = coldRentPerUnit ?? coldRentSingle;

    // City: aus Adresse ableiten (sehr konservativ, deterministisch)
let cityHint: string | null = null;

// 1) Wenn wir eine PLZ gefunden haben: nimm das Wort danach als City (z.B. "10115 Berlin")
if (postcode) {
  const re = new RegExp(String(postcode).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+([A-Za-zÄÖÜäöüß\\- ]{2,40})", "i");
  const m = normalizedText.match(re);
  if (m && m[1]) {
    const raw = m[1].trim();
    // city endet oft vor Komma/Punkt
    const cut = raw.split(/[,.;\n\r]/)[0].trim();
    if (cut.length >= 2) cityHint = cut;
  }
}

// 2) Fallback: "Berlin" explizit im Text (nur als letzter Notnagel)
if (!cityHint && /\bberlin\b/i.test(normalizedText)) {
  cityHint = "Berlin";
}


    // (A) System "latest per user": doc:summary muss STABIL bleiben (für Phase11 LATEST)
// -> Entity darf NICHT rawEventId enthalten.
// -> Wir binden an userRef (kommt aus RawEventDoc.userRef -> extractor input meta)
    const userRef = String((input as any)?.meta?.userRef ?? "").trim();

// E3 FIX: nicht fail-fast.
// Wenn userRef fehlt, erzeugen wir einen stabilen Fallback-Fingerprint,
// damit doc:summary trotzdem geschrieben werden kann (und die Extraktion nicht stirbt).
    let docEntityFingerprint: string;

    if (userRef) {
      docEntityFingerprint = `user:${userRef}::doc_summary`;
    } else {
  // Fallback: kein User-Kontext verfügbar. Wir bleiben stabil, aber nicht "per user".
  // (Wichtig: kein Date.now / keine Randomness)
  console.warn("[real_estate.v1] missing meta.userRef in extractor input; using fallback fingerprint");
  docEntityFingerprint = `doc_summary::raw:${rawEventId}`;
}

const docSummaryFact: FactInput = {
  factId: "",
  entityId: "",

  entityDomain: "real_estate",
  entityType: "document",
  entityFingerprint: docEntityFingerprint,

  key: "doc:summary",
  domain: "real_estate",

  value: {
    hasColdRent,
    coldRent,
    cityHint,
  },

  source: "raw_event",
  sourceRef: rawEventId,

  meta: {
    system: true,
    latest: true,
    locale,
    extractorId: "real_estate.v1",
    rawEventId,
  },
};

    // =========================================================
    // (B) Property-Entity: echtes Wissen (nicht system)
    // =========================================================
    // MVP: Wenn du noch keine Adresse/PLZ extrahierst, ist Fingerprint schwach,
    // aber besser als "portfolio". Später erweitern.


const baseFingerprint = buildPropertyFingerprintV1({
  city: cityHint ?? undefined,
  postcode: postcode ?? undefined,
  street: street ?? undefined,
  houseNumber: houseNumber ?? undefined,
});

// Wenn alles unknown ist → rawEvent-scoped Entity (keine Kollisionen)
const isUnknownProperty =
  baseFingerprint.includes("unknown_city") &&
  baseFingerprint.includes("unknown_postcode") &&
  baseFingerprint.includes("unknown_address");

const propertyFingerprint = isUnknownProperty
  ? `re:property:unknown::raw:${rawEventId}`
  : baseFingerprint;

logger.info("re_v1_fingerprint_debug", {
  rawEventId,
  cityHint,
  postcode,
  street,
  houseNumber,
  propertyFingerprint,
});

    const propertyFacts: FactInput[] = [];



    // Zusätzliche Knowledge-Facts (latest)
if (unitsCount !== null) {
  propertyFacts.push({
    factId: "",
    entityId: "",
    entityDomain: "real_estate",
    entityType: "property",
    entityFingerprint: propertyFingerprint,
    key: "units_count",
    domain: "real_estate",
    value: unitsCount,
    source: "raw_event",
    sourceRef: rawEventId,
    meta: { locale, extractorId: "real_estate.v1", rawEventId, latest: true },
  });
}

if (unitsTotal !== null) {
  propertyFacts.push({
    factId: "",
    entityId: "",
    entityDomain: "real_estate",
    entityType: "property",
    entityFingerprint: propertyFingerprint,
    key: "units_total",
    domain: "real_estate",
    value: unitsTotal,
    source: "raw_event",
    sourceRef: rawEventId,
    meta: { locale, extractorId: "real_estate.v1", rawEventId, latest: true },
  });
}

if (nkPerUnit !== null) {
  propertyFacts.push({
    factId: "",
    entityId: "",
    entityDomain: "real_estate",
    entityType: "property",
    entityFingerprint: propertyFingerprint,
    key: "rent_nk",
    domain: "real_estate",
    value: nkPerUnit,
    source: "raw_event",
    sourceRef: rawEventId,
    meta: { locale, extractorId: "real_estate.v1", rawEventId, latest: true },
  });
}

if (shopColdRent !== null) {
  propertyFacts.push({
    factId: "",
    entityId: "",
    entityDomain: "real_estate",
    entityType: "property",
    entityFingerprint: propertyFingerprint,
    key: "shop_rent_cold",
    domain: "real_estate",
    value: shopColdRent,
    source: "raw_event",
    sourceRef: rawEventId,
    meta: { locale, extractorId: "real_estate.v1", rawEventId, latest: true },
  });
}

if (shopNk !== null) {
  propertyFacts.push({
    factId: "",
    entityId: "",
    entityDomain: "real_estate",
    entityType: "property",
    entityFingerprint: propertyFingerprint,
    key: "shop_rent_nk",
    domain: "real_estate",
    value: shopNk,
    source: "raw_event",
    sourceRef: rawEventId,
    meta: { locale, extractorId: "real_estate.v1", rawEventId, latest: true },
  });
}

    if (coldRent !== null) {
      propertyFacts.push({
        factId: "",
        entityId: "",

        entityDomain: "real_estate",
        entityType: "property",
        entityFingerprint: propertyFingerprint,

        key: "rent_cold",
        domain: "real_estate",
        value: coldRent,

        source: "raw_event",
        sourceRef: rawEventId,

        meta: {
        locale,
        extractorId: "real_estate.v1",
        rawEventId,
        latest: true,
},
      });
    }

    if (cityHint) {
      propertyFacts.push({
        factId: "",
        entityId: "",

        entityDomain: "real_estate",
        entityType: "property",
        entityFingerprint: propertyFingerprint,

        key: "city",
        domain: "real_estate",
        value: cityHint,

        source: "raw_event",
        sourceRef: rawEventId,

        meta: {
          locale,
          extractorId: "real_estate.v1",
          rawEventId,
          latest: true,
        },
      });
    }

    // Ergebnis: 1 Systemfact (doc) + N Knowledge-facts (property)
    return {
      facts: [docSummaryFact, ...propertyFacts],
      warnings: [],
    };
  },
};