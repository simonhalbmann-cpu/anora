// functions/src/core/runner/runAllExtractorsOnRawEventV1.ts
import * as logger from "firebase-functions/logger";
import { getOrCreateEntityIdByFingerprint } from "../entities/store";
import { getExtractor, listExtractors } from "../facts/registry";
import { upsertManyFacts } from "../facts/store";
import type { FactInput } from "../facts/types";
import {
  markRawEventRunDone,
  markRawEventRunError,
  markRawEventRunStart,
  patchRawEventProcessing,
} from "../rawEvents/store";
import type { RawEventDoc } from "../rawEvents/types";
import { toExtractorInputV1 } from "./extractorInput";

const now = () => Date.now();

function ms(t0: number) {
  return `${Date.now() - t0}ms`;
}

function validateFactInputV1(f: any): { ok: boolean; reason?: string } {
  if (!f || typeof f !== "object") return { ok: false, reason: "not_object" };

  const key = typeof f.key === "string" ? f.key.trim() : "";
  if (!key) return { ok: false, reason: "missing_key" };

  const domain = typeof f.domain === "string" ? f.domain.trim() : "";
  if (!domain) return { ok: false, reason: "missing_domain" };

  const source = typeof f.source === "string" ? f.source.trim() : "";
  if (!source) return { ok: false, reason: "missing_source" };

  const sourceRef = typeof f.sourceRef === "string" ? f.sourceRef.trim() : "";
  if (!sourceRef) return { ok: false, reason: "missing_sourceRef" };

  // value darf null sein, aber nicht undefined
  if (typeof f.value === "undefined") return { ok: false, reason: "missing_value" };

  const entityId = typeof f.entityId === "string" ? f.entityId.trim() : "";
  if (entityId) return { ok: true };

  const fp = typeof f.entityFingerprint === "string" ? f.entityFingerprint.trim() : "";
  const ed = typeof f.entityDomain === "string" ? f.entityDomain.trim() : "";
  if (fp && ed) return { ok: true };

  return { ok: false, reason: "missing_entity_resolver" };
}

async function safePatchProcessing(
  userId: string,
  rawEventId: string,
  patch: any
) {
  try {
    await patchRawEventProcessing(userId, rawEventId, patch);
  } catch (e) {
    // Observability darf nie den Runner killen
    logger.warn("rawEvent_processing_patch_failed", {
      userId,
      rawEventId,
      error: String(e),
    });
  }
}


export async function runAllExtractorsOnRawEventV1Core(opts: {
  userId: string;
  rawEventId: string;
  raw: RawEventDoc;
  // optional: nur bestimmte Extractors laufen lassen
  extractorIds?: string[];
}) {
  const { userId, rawEventId, raw } = opts;
  // PHASE 2: [] bedeutet "Satelliten AUS" und muss respektiert werden.
// undefined bedeutet "default = alle".
const extractorIds = Array.isArray(opts.extractorIds)
  ? opts.extractorIds
  : listExtractors();

  const tAll = now();

  logger.info("runner_all_extractors_v1_start", {
  userId,
  rawEventId,
  extractorIdsCount: extractorIds.length,
});

await markRawEventRunStart({
  userId,
  rawEventId,
  runner: "runAllExtractorsOnRawEventV1",
  extractorIds,
});

  try {


  // 1) standardisierter Input
  const input = toExtractorInputV1(rawEventId, raw);

  // 2) alle Extractors laufen lassen
  const allFacts: any[] = [];
  const allWarnings: any[] = [];
  const perExtractor: any[] = [];

  for (const extractorId of extractorIds) {
    const ex = getExtractor(extractorId);
    if (!ex) {
      perExtractor.push({ extractorId, ok: false, error: "unknown_extractor" });
      continue;
    }

logger.info("runner_all_extractors_v1_extract_start", {
    userId,
    rawEventId,
    extractorId,
    took: ms(tAll),
  });

    try {
      const result = await ex.extract({
        rawEventId: input.rawEventId,
        locale: input.locale,
        sourceType: input.sourceType,
        payload: input.payload,
        meta: input.meta,
      });

      const facts = Array.isArray(result?.facts) ? result.facts : [];
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

      // PHASE 1: harte Validation (reject statt "wird schon passen")
const cleaned = facts.filter((f: any) => {
  const v = validateFactInputV1(f);
  if (!v.ok) {
    logger.warn("runner_fact_rejected", {
      userId,
      rawEventId,
      extractorId,
      reason: v.reason,
      key: typeof f?.key === "string" ? f.key : null,
      domain: typeof f?.domain === "string" ? f.domain : null,
    });
    return false;
  }
  return true;
});

      allFacts.push(...cleaned);
      allWarnings.push(...warnings);

      perExtractor.push({
        extractorId,
        ok: true,
        factsIn: facts.length,
        factsAccepted: cleaned.length,
        warnings: warnings.length,
      });

logger.info("runner_all_extractors_v1_extract_done", {
  userId,
  rawEventId,
  extractorId,
  factsIn: facts.length,
  factsAccepted: cleaned.length,
  warnings: warnings.length,
  took: ms(tAll),
});

    } catch (err) {
  perExtractor.push({ extractorId, ok: false, error: String(err) });

  logger.warn("runner_all_extractors_v1_extract_failed", {
    userId,
    rawEventId,
    extractorId,
    error: String(err),
    took: ms(tAll),
  });
}

  }


  logger.info("runner_all_extractors_v1_after_extract", {
    userId,
    rawEventId,
    factsCollected: allFacts.length,
    warningsCollected: allWarnings.length,
    took: ms(tAll),
  });

  await safePatchProcessing(userId, rawEventId, {
  v1: {
    stage: "after_extract",
    factsCollected: allFacts.length,
    warningsCollected: allWarnings.length,
    tookMs: Date.now() - tAll,
  },
});

  // 3) Entity-Resolution (einmal für alle Facts)
  
  const tResolve = now();
logger.info("runner_all_extractors_v1_resolve_start", {
  userId,
  rawEventId,
  factsToResolve: allFacts.length,
});

  const resolvedFacts: FactInput[] = [];

  for (const f of allFacts as any[]) {
    if (typeof f.entityId === "string" && f.entityId.trim()) {
      resolvedFacts.push(f);
      continue;
    }

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

    resolvedFacts.push(f);
  }

  logger.info("runner_all_extractors_v1_resolve_done", {
  userId,
  rawEventId,
  resolvedFacts: resolvedFacts.length,
  took: ms(tResolve),
});

await safePatchProcessing(userId, rawEventId, {
  v1: {
    stage: "after_resolve",
    resolvedFacts: resolvedFacts.length,
    tookMs: Date.now() - tAll,
  },
});

  // 4) Persist Facts (einmal)
  const tUpsert = now();
logger.info("runner_all_extractors_v1_upsert_start", {
  userId,
  rawEventId,
  factsToUpsert: resolvedFacts.length,
});

const write = await upsertManyFacts(userId, resolvedFacts);

logger.info("runner_all_extractors_v1_upsert_done", {
  userId,
  rawEventId,
  upserted: write.upserted,
  skipped: write.skipped,
  took: ms(tUpsert),
});

await markRawEventRunDone({
  userId,
  rawEventId,
  runner: "runAllExtractorsOnRawEventV1",
  stats: {
    extractorCount: extractorIds.length,
    factsAccepted: resolvedFacts.length,
    upserted: write.upserted,
    skipped: write.skipped,
    warningsCount: allWarnings.length,
    perExtractor,
    tookMs: Date.now() - tAll,
  },
});

// optional: stage “done” (Debug/UX)

  logger.info("runner_all_extractors_v1_done", {
    userId,
    rawEventId,
    extractorCount: extractorIds.length,
    factsAccepted: resolvedFacts.length,
    upserted: write.upserted,
    skipped: write.skipped,
  });

  return {
      ok: true,
      userId,
      rawEventId,
      extractorIds,
      extractorCount: extractorIds.length,
      factsAccepted: resolvedFacts.length,
      upserted: write.upserted,
      skipped: write.skipped,
      warnings: allWarnings,
      perExtractor,
      debug: {
        input,
      },
    };
  } catch (err) {
    // 1) Persistenter Fehler am RawEvent (für UI/Debug)
    await markRawEventRunError({
      userId,
      rawEventId,
      runner: "runAllExtractorsOnRawEventV1",
      error: err,
    });

    await safePatchProcessing(userId, rawEventId, {
  v1: {
    stage: "error",
    tookMs: Date.now() - tAll,
  },
});

    throw err;
  }
}