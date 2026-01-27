// functions/src/core/utils/stableStringify.ts
// Deterministische Serialisierung: key-sorted, OHNE semantische Änderungen.
// Wichtig: stableStringify darf Werte NICHT "korrigieren" (kein trim, kein rounding, kein undefined->null).
// Dafür gibt es normalizeForHashV1.

export function stableStringify(value: any): string {
  return JSON.stringify(stableNormalize(value));
}

/**
 * Stabilisiert nur die Reihenfolge von Object-Keys und rekursiv die Struktur.
 * Verändert KEINE Werte.
 *
 * - undefined bleibt undefined (JSON.stringify lässt es in Objekten weg, in Arrays wird es zu null)
 * - Strings bleiben unverändert (kein trim)
 * - Numbers bleiben unverändert (kein rounding)
 * - Non-JSON Werte (Function/Symbol/BigInt) werden wie JSON.stringify behandelt:
 *   - in Objekten: entfernt (undefined)
 *   - in Arrays: null (durch JSON.stringify)
 */
function stableNormalize(v: any): any {
  if (v === null) return null;

  const t = typeof v;

  if (t === "number" || t === "string" || t === "boolean") return v;

  // JSON.stringify kann BigInt nicht -> wir entfernen es wie "nicht serialisierbar"
  if (t === "bigint" || t === "function" || t === "symbol") return undefined;

  if (v === undefined) return undefined;

  if (Array.isArray(v)) {
    return v.map((x) => stableNormalize(x));
  }

  if (t === "object") {
    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) {
      const nv = stableNormalize(v[k]);
      // wie JSON.stringify: undefined in Objekten wird weggelassen
      if (nv === undefined) continue;
      out[k] = nv;
    }
    return out;
  }

  // alles andere (z.B. Date, Map, Set): JSON.stringify macht daraus {} oder etwas komisches,
  // wir lassen es über den "object" Pfad laufen (falls es object war).
  return undefined;
}

/**
 * Optional: explizite Normalisierung fürs Hashing.
 * Nur nutzen, wenn ihr das wirklich wollt.
 */
export function normalizeForHashV1(value: any): any {
  return hashNormalize(value);
}

function hashNormalize(v: any): any {
  if (v === null || v === undefined) return null;

  const t = typeof v;

  if (t === "number") {
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 1e6) / 1e6;
  }

  if (t === "string") {
    return v.trim();
  }

  if (t === "boolean") {
    return v;
  }

  if (Array.isArray(v)) {
    return v.map(hashNormalize);
  }

  if (t === "object") {
    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) {
      if (v[k] === undefined) continue;
      out[k] = hashNormalize(v[k]);
    }
    return out;
  }

  return null;
}