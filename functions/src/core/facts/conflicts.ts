import * as admin from "firebase-admin";
import type { ResolveResult } from "./resolveCandidates";
import type { FactDoc } from "./types";

export type ConflictTicketV1 = {
  entityId: string;
  key: string;

  // minimales Kandidaten-Snapshot fürs UI/Debug
  candidates: Array<{
    factId: string;
    value: any;
    score: number;
    sourceType?: string | null;
    temporal?: string | null;
    latest?: boolean | null;
    confidence?: number | null;
    updatedAt?: number | null;
    source?: string | null;
  }>;

  createdAt: number;
  updatedAt: number;

  status: "open" | "resolved";
  resolvedByFactId?: string;
  userNote?: string;
};

function conflictDocId(entityId: string, key: string) {
  // Firestore doc ids dürfen viele Zeichen, aber wir halten es simpel und deterministisch:
  // ":" ist ok, "/" nicht. entityId/key enthalten bei uns kein "/".
  return `conflict_v1__${entityId}__${key}`;
}

export async function upsertConflictTicket(params: {
  uid: string;
  entityId: string;
  key: string;
  candidates: FactDoc[];
  resolveResult: ResolveResult;
  debugScores: Array<{ factId: string; score: number; value: any; meta: any }>;
}): Promise<void> {
  const { uid, entityId, key, candidates, resolveResult, debugScores } = params;

  const now = Date.now();

  // Map score by factId
  const scoreById = new Map<string, number>();
  for (const s of debugScores) scoreById.set(s.factId, s.score);

  const ticket: ConflictTicketV1 = {
    entityId,
    key,
    candidates: candidates.map((f) => {
      const meta = (f as any).meta ?? {};
      return {
        factId: (f as any).factId,
        value: (f as any).value,
        score: scoreById.get((f as any).factId) ?? 0,
        sourceType: meta.sourceType ?? null,
        temporal: meta.temporal ?? null,
        latest: meta.latest ?? null,
        confidence: meta.confidence ?? (f as any).confidence ?? null,
        updatedAt: (f as any).updatedAt ?? null,
        source: (f as any).source ?? null,
      };
    }),
    createdAt: now,
    updatedAt: now,
    status: "open",
  };

  // Wenn needs_user => Ticket muss existieren
  // Wenn resolved_with_conflict => Ticket auch schreiben, weil Konflikt existiert
  const shouldWrite =
    resolveResult.status === "needs_user" ||
    (resolveResult.status === "resolved_with_conflict" && resolveResult.conflict === true);

  if (!shouldWrite) return;

  const ref = admin
    .firestore()
    .doc(`brain/${uid}/meta/${conflictDocId(entityId, key)}`);

  await ref.set(ticket, { merge: true });
}