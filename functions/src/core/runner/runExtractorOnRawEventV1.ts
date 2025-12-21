// functions/src/core/runner/runExtractorOnRawEventV1.ts
import { getOrCreateEntityIdByFingerprint } from "../entities/store";
import { getExtractor } from "../facts/registry";
import { upsertManyFacts } from "../facts/store";
import type { FactInput } from "../facts/types";
import type { RawEventDoc } from "../rawEvents/types";
import { toExtractorInputV1 } from "./extractorInput";

export async function runExtractorOnRawEventV1Core(opts: {
  userId: string;
  rawEventId: string;
  extractorId: string;
  raw: RawEventDoc;
}) {
  const { userId, rawEventId, extractorId, raw } = opts;

  const ex = getExtractor(extractorId);
  if (!ex) {
    throw new Error(`Unknown extractorId: ${extractorId}`);
  }

  // 1) ExtractorInput (zentral/standardisiert)
  const input = toExtractorInputV1(rawEventId, raw);

  // 2) Extract
  const result = await ex.extract({
    rawEventId: input.rawEventId,
    locale: input.locale,
    sourceType: input.sourceType,
    payload: input.payload,
    meta: input.meta,
  });

  const facts = Array.isArray(result?.facts) ? result.facts : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  // 3) Minimal-Härtung: Facts ohne key weg
  const cleanedFacts = facts.filter(
    (f: any) => f && typeof f === "object" && typeof f.key === "string" && f.key.trim()
  );

  // ------------------------------------------------------------
  // PRE-RESOLVE entityId (damit Facts entityId haben)
  // ------------------------------------------------------------
  const resolvedFacts: FactInput[] = [];

  for (const f of cleanedFacts as any[]) {
    // a) entityId schon da
    if (typeof f.entityId === "string" && f.entityId.trim()) {
      resolvedFacts.push(f);
      continue;
    }

    // b) Resolver-Infos da
    const hasResolver =
      typeof f.entityFingerprint === "string" && f.entityFingerprint.trim() &&
      typeof f.entityDomain === "string" && f.entityDomain.trim();

    if (hasResolver) {
      const r = await getOrCreateEntityIdByFingerprint({
        userId,
        domain: f.entityDomain,
        type: f.entityType ?? "generic",
        fingerprint: f.entityFingerprint,
      });
      resolvedFacts.push({ ...f, entityId: r.entityId });
      continue;
    }

    // c) sonst unverändert
    resolvedFacts.push(f);
  }

  const cleanedFacts2 = resolvedFacts;

  // ------------------------------------------------------------
  // docEntity Fallback nur wenn wirklich nötig
  // ------------------------------------------------------------
  const needsDocEntityFallback = cleanedFacts2.some((f: any) => {
    const hasEntityId = typeof f.entityId === "string" && f.entityId.trim();
    const hasResolver =
      typeof f.entityFingerprint === "string" && f.entityFingerprint.trim() &&
      typeof f.entityDomain === "string" && f.entityDomain.trim();
    return !hasEntityId && !hasResolver;
  });

  const docEntity = needsDocEntityFallback
    ? await getOrCreateEntityIdByFingerprint({
        userId,
        domain: "real_estate",
        type: "document",
        fingerprint: `rawEvent:${rawEventId}`,
        label: `Dokument ${rawEventId}`,
      })
    : null;

  const factsWithEntity = cleanedFacts2.map((f: any) => {
    if (typeof f.entityId === "string" && f.entityId.trim()) return f;

    const hasResolver =
      typeof f.entityFingerprint === "string" && f.entityFingerprint.trim() &&
      typeof f.entityDomain === "string" && f.entityDomain.trim();

    if (hasResolver) return f;

    if (docEntity?.entityId) return { ...f, entityId: docEntity.entityId };

    return f;
  });

  // 4) Persist Facts
  const write = await upsertManyFacts(userId, factsWithEntity);

  return {
    ok: true,
    userId,
    rawEventId,
    extractorId,
    factsIn: facts.length,
    factsAccepted: cleanedFacts.length,
    upserted: write.upserted,
    skipped: write.skipped,
    warnings,
    debug: {
      docEntity,
      cleanedFacts,
      factsWithEntity,
      write,
    },
  };
}