// functions/src/domains/real_estate/utils/parse.ts

export function normalizeTextForParsing(s: string): string {
  let out = String(s ?? "");

  // häufige Mojibake-Fälle aus Copy/Paste / falschem Encoding
  out = out
    .replace(/ÃŸ/g, "ß")
    .replace(/Ã¤/g, "ä")
    .replace(/Ã¶/g, "ö")
    .replace(/Ã¼/g, "ü")
    .replace(/\uFFFD/g, "ss"); // statt entfernen

  return out;
}

export function extractGermanPostcode(text: string): string | undefined {
  const m = String(text ?? "").match(/\b(\d{5})\b/);
  return m ? m[1] : undefined;
}

export function extractStreetAndHouseNumber(
  text: string
): { street?: string; houseNumber?: string } {
  // 0) Whitespace stabilisieren (Copy/Paste: NBSP etc.)
  let t = String(text ?? "")
    .replace(/\u00A0/g, " ") // NBSP -> Space
    .replace(/\s+/g, " ")
    .trim();

  // 1) Matching-Kopie normalisieren
  const tMatch = t
    .replace(/\./g, "") // "str." -> "str"
    .replace(/ß/gi, "ss")
    // kaputte Straße/Strasse Varianten reparieren
    .replace(/stra\uFFFD?e/gi, "strasse") // "stra�e" / "strae" -> "strasse"
    // jetzt die Suffix-Varianten vereinheitlichen:
    // wichtig: "Musterstr" (Suffix) muss auch zu "Musterstrasse" werden
    .replace(/straße\b/gi, "strasse")
    .replace(/strasse\b/gi, "strasse")
    .replace(/str\b/gi, "strasse") // <- DAS ist der entscheidende Fix (Suffix am Wortende)
    .replace(/\uFFFD/g, "");

  // 2) Regex auf normalisiertem Text
  const m = tMatch.match(
    /(?:^|[\s,;])([A-Za-zÄÖÜäöü][A-Za-zÄÖÜäöü.\- ]{2,60}?(?:strasse|weg|allee|ring|platz|gasse|damm|ufer|chaussee))\s+(\d{1,5}[a-zA-Z]?)\b/i
  );

  if (!m) return {};

  // 3) Rückgabe bewusst NORMALISIERT (für stabilen Fingerprint)
  return { street: String(m[1] ?? "").trim(), houseNumber: String(m[2] ?? "").trim() };
}