// functions/src/core/runner/runExtractorOnRawEventV1.ts

import type { EntityResolverV1 } from "../../core/entities/resolver";
import { getExtractor } from "../../core/facts/registry";
import { upsertManyFacts } from "../../core/facts/store";
import type { FactInput } from "../../core/facts/types";
import type { RawEventDoc } from "../../core/rawEvents/types";
import { toExtractorInputV1 } from "../../core/runner/extractorInput";

export async function runExtractorOnRawEventV1Core(
  opts: {
    userId: string;
    rawEventId: string;
    extractorId: string;
    raw: RawEventDoc;
  },
  deps?: { entityResolver?: EntityResolverV1 }
) {
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
  const resolver = deps?.entityResolver?.getOrCreateEntityIdByFingerprint;

  if (!resolver) {
    // Phase 2: kein Resolver injected => Core resolved NICHT
    resolvedFacts.push(f);
    continue;
  }

  const entityDomain = String((f as any).entityDomain ?? "").trim();
  const fingerprintRaw = String((f as any).entityFingerprint ?? "").trim();

  if (!entityDomain || !fingerprintRaw) {
    resolvedFacts.push(f);
    continue;
  }

  const r = await resolver({
    userId,
    entityDomain,
    fingerprintRaw,
  });

  if (r?.entityId) {
    resolvedFacts.push({ ...f, entityId: r.entityId });
  } else {
    resolvedFacts.push(f);
  }
  continue;
}

    // c) sonst unverändert
    resolvedFacts.push(f);
  }

  const cleanedFacts2 = resolvedFacts;

 // ------------------------------------------------------------
// PHASE 2: kein docEntity-Fallback.
// Facts OHNE entityId werden NICHT persistiert.
// ------------------------------------------------------------
const hasEntityId = (f: any) => typeof f?.entityId === "string" && f.entityId.trim();

const droppedFacts = cleanedFacts2.filter((f: any) => !hasEntityId(f));
if (droppedFacts.length > 0) {
  warnings.push(`facts_dropped_missing_entityId:${droppedFacts.length}`);
}

const factsToPersist = cleanedFacts2.filter((f: any) => hasEntityId(f));

  // 4) Persist Facts
  const write = await upsertManyFacts(userId, factsToPersist);

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
  cleanedFacts,
  resolvedFacts: cleanedFacts2,
  factsToPersistCount: factsToPersist.length,
  droppedFactsCount: droppedFacts.length,
  write,
},
  };
}