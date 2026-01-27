// functions/src/core/facts/factResolverConfig.ts
// PHASE 2.3: Tie-Definition (Δ)

export const FACT_SCORE_TIE_DELTA = 2;

/**
 * Tie = zwei Scores sind "praktisch gleich stark".
 * Wenn |a - b| <= Δ => Tie-Kandidat
 */
export function isTieScore(a: number, b: number, delta = FACT_SCORE_TIE_DELTA): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= delta;
}