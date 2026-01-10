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

    // --- Demo Parsing ---
    const hasColdRent = /kaltmiete/i.test(normalizedText);

    const rentMatch =
      normalizedText.match(/kaltmiete\s*[:\-]?\s*([0-9]{2,6})(?:\s*(?:€|eur))?/i) ??
      normalizedText.match(/([0-9]{2,6})\s*(?:€|eur)\b/i);

    const coldRent = rentMatch ? Number(rentMatch[1]) : null;

    const cityHint = /berlin/i.test(normalizedText) ? "Berlin" : null;


    // (A) System "latest per user": doc:summary muss STABIL bleiben (für Phase11 LATEST)
// -> Entity darf NICHT rawEventId enthalten.
// -> Wir binden an userRef (kommt aus RawEventDoc.userRef -> extractor input meta)
const userRef =
  String((input as any)?.meta?.userRef ?? "").trim();

if (!userRef) {
  // Fail fast: wenn userRef nicht da ist, kann doc:summary nicht "per user" stabil sein.
  throw new Error("real_estate.v1: missing meta.userRef in extractor input");
}

const docEntityFingerprint = `user:${userRef}::doc_summary`;

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

const postcode = extractGermanPostcode(normalizedText);
const { street, houseNumber } = extractStreetAndHouseNumber(normalizedText);

const propertyFingerprint = buildPropertyFingerprintV1({
  city: cityHint ?? undefined,
  postcode: postcode ?? undefined,
  street: street ?? undefined,
  houseNumber: houseNumber ?? undefined,
});

logger.info("re_v1_fingerprint_debug", {
  rawEventId,
  cityHint,
  postcode,
  street,
  houseNumber,
  propertyFingerprint,
});

    const propertyFacts: FactInput[] = [];

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