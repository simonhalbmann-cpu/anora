// functions/src/core/facts/locale.ts
// Roadmap 3.6: Locale Layer (minimal)
// Ziel: "1.200,50 €" (de-DE) -> 1200.5 (number), bevor FactId/Conflict läuft

export function normalizeFactValueByLocale(
  value: any,
  locale: string
): any {
  if (value === null || value === undefined) return null;

  // Arrays rekursiv
  if (Array.isArray(value)) {
    return value.map((v) => normalizeFactValueByLocale(v, locale));
  }

  // Objekte rekursiv (key-sorted egal, nur Values normalisieren)
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) {
      out[k] = normalizeFactValueByLocale((value as any)[k], locale);
    }
    return out;
  }

  // Strings: trim + Zahl erkennen
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";

    const num = tryParseLocaleNumber(s, locale);
    if (num !== null) return num;

    return s; // sonst unverändert
  }

  // number/bool bleiben
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") return value;

  return null;
}

function tryParseLocaleNumber(inputRaw: string, locale: string): number | null {
  // Entferne Währungszeichen, NBSP, normale Spaces, Prozent etc.
  let s = inputRaw
    .replace(/\u00A0/g, " ")
    .replace(/[€$£]/g, "")
    .replace(/%/g, "")
    .trim();

  if (!s) return null;

  // Erlaubte Zeichen grob prüfen
  // (damit wir nicht "Haus 12" als Zahl parsen)
  if (!/^[0-9.,+\- ]+$/.test(s)) return null;

  // Spaces raus (Tausender-Spaces)
  s = s.replace(/\s+/g, "");

  // de-DE: "." Tausender, "," Dezimal
  // en: "," Tausender, "." Dezimal
  const isGerman = locale.toLowerCase().startsWith("de");

  if (isGerman) {
    // Tausenderpunkte entfernen
    s = s.replace(/\./g, "");
    // Dezimalkomma zu Punkt
    s = s.replace(/,/g, ".");
  } else {
    // grob: en-Style
    s = s.replace(/,/g, "");
  }

  // Jetzt muss es wie eine JS-Number aussehen
  if (!/^[+\-]?\d+(\.\d+)?$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  // harte Rundung wie in stableStringify (optional, aber konsistent)
  return Math.round(n * 1e6) / 1e6;
}