// functions/src/core/facts/factValueEquals.ts

import { stableStringify } from "../utils/stableStringify";

/**
 * Deterministische Gleichheit von Fact-Werten.
 * KEINE Semantik. KEIN Raten.
 */
export function factValueEquals(a: unknown, b: unknown): boolean {
  // exakt gleich oder beide null/undefined
  if (a === b) return true;
  if (a == null || b == null) return false;

  const ta = typeof a;
  const tb = typeof b;

  // Primitive Typen
  if (ta !== "object" && tb !== "object") {
    return a === b;
  }

  // Arrays / Objekte → stabiler JSON-Vergleich
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    // Wenn etwas nicht serialisierbar ist → NICHT gleich
    return false;
  }
}