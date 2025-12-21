// functions/src/core/utils/stableStringify.ts
// stabile Serialisierung (key-sorted), damit Hashes deterministisch sind

export function stableStringify(value: any): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: any): any {
  if (v === null || v === undefined) return null;

  const t = typeof v;

  if (t === "number") {
    if (!Number.isFinite(v)) return null;
    // harte Normalisierung: z.B. 1200.0000001 vermeiden
    return Math.round(v * 1e6) / 1e6;
  }

  if (t === "string") {
    return v.trim();
  }

  if (t === "boolean") {
    return v;
  }

  if (Array.isArray(v)) {
    return v.map(normalize);
  }

  if (t === "object") {
    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) {
      // skip undefined
      if (v[k] === undefined) continue;
      out[k] = normalize(v[k]);
    }
    return out;
  }

  // fallback (z.B. Funktionen, Symbole): null
  return null;
}