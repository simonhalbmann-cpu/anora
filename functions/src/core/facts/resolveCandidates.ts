// functions/src/core/facts/resolveCandidates.ts
// PHASE 2.4 — Deterministischer Resolver

import { isTieScore } from "./factResolverConfig";
import { computeFactStrength } from "./factStrength";
import { factValueEquals } from "./factValueEquals";
import type { FactDoc } from "./types";

// --------------------------------------------------
// Ergebnis-Typ
// --------------------------------------------------

export type ResolveResult =
  | {
      status: "resolved" | "resolved_with_conflict";
      winner: FactDoc;
      conflict: boolean;
      debugScores: DebugScore[];
    }
  | {
      status: "needs_user";
      tie: true;
      candidates: DebugScore[];
    };

export type DebugScore = {
  factId: string;
  score: number;
  value: any;
  meta: any;
};

// --------------------------------------------------
// Resolver
// --------------------------------------------------

export function resolveCandidates(
  entityId: string,
  key: string,
  candidates: FactDoc[]
): ResolveResult {
  if (candidates.length === 0) {
    throw new Error("resolveCandidates called with empty candidates");
  }

// PHASE 4 — User override hat absolute Priorität
  const userOverride = candidates.find(
    (f) => f.meta?.override === true && f.meta?.finality === "final"
  );

  if (userOverride) {
    const conflict = candidates.some((c) => !factValueEquals(c.value, userOverride.value));
    const status = conflict ? "resolved_with_conflict" : "resolved";

    return {
      status,
      winner: userOverride,
      conflict,
      debugScores: candidates.map((c) => ({
        factId: c.factId,
        score: 0, // Override: Score nicht relevant, aber JSON-sicher (kein NaN->null)
        value: c.value,
        meta: c.meta,
      })),
    };
  }

  // 1) Scores berechnen (HART normalisiert)
const scored: DebugScore[] = candidates.map((f) => {
  const raw = computeFactStrength({
    sourceType: f.meta?.sourceType ?? "other",
    sourceReliability: f.meta?.sourceReliability ?? 0.5,
    confidence: f.meta?.confidence ?? 0.5,
    temporal: f.meta?.temporal ?? "unknown",
    userConfirmed: f.meta?.userConfirmed === true,
    system: f.meta?.system === true,
    latest: f.meta?.latest === true,
    satelliteId: f.meta?.satelliteId ?? "unknown",
  });

  // 🔒 ABSOLUTE GARANTIE: score ist IMMER eine Zahl
  const score =
    typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : 0;

  return {
    factId: f.factId,
    score,
    value: f.value,
    meta: f.meta,
  };
});

  // 2) Nach Score sortieren (absteigend)
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  const top = sorted[0];
  const second = sorted[1];

  // 3) Tie?
  if (second && isTieScore(top.score, second.score)) {
    // Wenn Values gleich sind => KEIN Rückfrage-Fall (Duplicate/gleiches Value)
    if (factValueEquals(top.value, second.value)) {
      // weiterlaufen, wir lösen unten normal "resolved"
    } else {
      return {
        status: "needs_user",
        tie: true,
        candidates: sorted,
      };
    }
  }

  // 4) Conflict? (nur wenn es mindestens EINEN anderen Wert gibt)
  const conflict = sorted.some((s) => !factValueEquals(s.value, top.value));

  // 5) Winner bestimmen
  const winner = candidates.find((f) => f.factId === top.factId);
  if (!winner) {
    throw new Error("Winner fact not found");
  }

const status = conflict ? "resolved_with_conflict" : "resolved";

  return {
    status,
    winner,
    conflict,
    debugScores: sorted,
  };
}