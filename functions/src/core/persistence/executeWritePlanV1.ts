// functions/src/core/persistence/executeWritePlanV1.ts
// PHASE 6.3 – impure executor (the ONLY place that writes)

import admin from "firebase-admin";
import type { DailyDigestContributionV1 } from "../meta/dailyDigestTypes";
import { dayBucketUTC } from "../rawEvents/hash";
import type { RunCoreOnceOutput } from "../runCoreOnce";
import { sha256Hex } from "../utils/hash";
import { stableStringify } from "../utils/stableStringify";
import {
  evidenceRef,
  factHistoryRef,
  factRef,
  haltungRef,
  rawEventRef,
} from "./firestoreExecutorV1";


import type { CoreWritePlanV1, PersistenceResultV1 } from "./types";

export let __EXECUTOR_CALLS__ = 0;

export function __resetExecutorCalls__() {
  __EXECUTOR_CALLS__ = 0;
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as any;
  if (value === null) return value;

  if (Array.isArray(value)) {
    return value
      .map((v) => stripUndefinedDeep(v))
      .filter((v) => v !== undefined) as any;
  }

  if (typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      const vv = stripUndefinedDeep(v);
      if (vv !== undefined) out[k] = vv;
    }
    return out;
  }

  return value;
}

function canonicalizeFactDocForNoop(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;

 const {
  updatedAt,
  createdAt,

  // wichtig: sourceRef soll KEIN Update triggern
  sourceRef,

  ...rest
} = doc;

  return rest;
}

function buildEvidenceId(params: { factId: string; sourceRef: string }) {
  return sha256Hex(`evidence::${params.factId}::${params.sourceRef}`);
}

function buildHistoryId(params: {
  factId: string;
  sourceRef: string;
  kind: "created" | "updated" | "superseded";
}) {
  return sha256Hex(
    `history::${params.factId}::${params.sourceRef}::${params.kind}`
  );
}

function digestMetaKeyForDay(dayBucket: string) {
  // brain/{userId}/meta/{key}
  // docId darf keine Slashes haben -> dayBucket ist "YYYY-MM-DD"
  return `dailyDigest_v1__${dayBucket}`;
}

function extractDigestContributions(out: RunCoreOnceOutput): DailyDigestContributionV1[] {
  const facts = Array.isArray((out as any)?.validatedFacts) ? (out as any).validatedFacts : [];

  // Tier kommt (wie früher beim Satellite) aus rawEvent.meta.tier
  const tierRaw = (out as any)?.rawEvent?.doc?.meta?.tier;
  const tier: "free" | "pro" = tierRaw === "pro" ? "pro" : "free";

  const res: DailyDigestContributionV1[] = [];

  for (const f of facts) {
    if (f?.key !== "doc:summary") continue;

    const extractorId = (f as any)?.meta?.extractorId;
    if (extractorId !== "document_understanding.v1") continue;

    const v = (f as any)?.value ?? {};
    const docType = typeof v?.docType === "string" && v.docType.trim() ? v.docType.trim() : "unknown";

    const reasonCodesRaw = (f as any)?.meta?.reasonCodes;
    const reasonCodes = Array.isArray(reasonCodesRaw) ? reasonCodesRaw.filter((x: any) => typeof x === "string") : [];

    res.push({
      version: 1,
      extractorId: "document_understanding.v1",
      tier,
      counts: {
        processedLocal: 1,
        blockedByTier: tier === "pro" ? 0 : 1,
        errors: 0,
      },
      docTypes: { [docType]: 1 },
      reasonCodes: reasonCodes.slice(0, 6),
    });

    // bounded: pro Run maximal 1 Contribution
    break;
  }

  return res;
}

function mergeDailyDigestDocs(params: {
  prev: any | null;
  dayBucket: string;
  rawEventId: string;
  contributions: DailyDigestContributionV1[];
  now: number;
}) {
  const { prev, dayBucket, rawEventId, contributions, now } = params;

  // ---- idempotency guard: prevent double-merge for same rawEventId
  const prevMerged: string[] = Array.isArray(prev?.mergedRawEventIds)
    ? prev.mergedRawEventIds.filter((x: any) => typeof x === "string")
    : [];

  if (prevMerged.includes(rawEventId)) {
    return { next: prev, changed: false, reason: "already_merged_rawEventId" as const };
  }

  // ---- base structure (matches your console output style)
  const base = {
    version: 1 as const,
    dayBucket,
    contributionsCount: 0,
    counts: { processedLocal: 0, blockedByTier: 0, errors: 0 },
    docTypes: {} as Record<string, number>,
    reasonCodes: [] as string[],
    mergedRawEventIds: [] as string[], // bounded
    updatedAt: now,
  };

  const prevDoc = prev && typeof prev === "object" ? prev : null;
  const next = { ...base };

  if (prevDoc) {
    next.contributionsCount = typeof prevDoc.contributionsCount === "number" ? prevDoc.contributionsCount : 0;

    const pc = prevDoc.counts && typeof prevDoc.counts === "object" ? prevDoc.counts : {};
    next.counts.processedLocal = typeof pc.processedLocal === "number" ? pc.processedLocal : 0;
    next.counts.blockedByTier = typeof pc.blockedByTier === "number" ? pc.blockedByTier : 0;
    next.counts.errors = typeof pc.errors === "number" ? pc.errors : 0;

    const pd = prevDoc.docTypes && typeof prevDoc.docTypes === "object" ? prevDoc.docTypes : {};
    for (const k of Object.keys(pd)) {
      const v = (pd as any)[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) next.docTypes[k] = Math.floor(v);
    }

    const pr: string[] = Array.isArray(prevDoc.reasonCodes)
      ? prevDoc.reasonCodes.filter((x: any) => typeof x === "string" && x.trim())
      : [];
    next.reasonCodes = pr.slice(0, 20); // bounded

    next.mergedRawEventIds = prevMerged.slice(0, 50);
  }

  // ---- merge contributions (THIS run)
  for (const c of contributions) {
    next.contributionsCount += 1;

    const cc = (c as any)?.counts ?? {};

    // MODEL A (Partition):
    // Jede Contribution zählt genau in EINE Kategorie:
    // errors OR blockedByTier OR processedLocal
    const blocked =
      typeof cc.blockedByTier === "number" &&
      Number.isFinite(cc.blockedByTier) &&
      cc.blockedByTier > 0;

    const errored =
      typeof cc.errors === "number" &&
      Number.isFinite(cc.errors) &&
      cc.errors > 0;

    if (errored) {
      next.counts.errors += 1;
    } else if (blocked) {
      next.counts.blockedByTier += 1;
    } else {
      next.counts.processedLocal += 1;
    }

    const dt = (c as any)?.docTypes ?? {};
    if (dt && typeof dt === "object") {
      for (const k of Object.keys(dt)) {
        const v = (dt as any)[k];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          next.docTypes[k] = (next.docTypes[k] ?? 0) + Math.floor(v);
        }
      }
    }

    const rc: string[] = Array.isArray((c as any)?.reasonCodes)
      ? (c as any).reasonCodes.filter((x: any) => typeof x === "string" && x.trim())
      : [];
    for (const code of rc) {
      if (code && !next.reasonCodes.includes(code)) next.reasonCodes.push(code);
    }
  }

  // idempotency stamp
  next.mergedRawEventIds = [rawEventId, ...next.mergedRawEventIds].slice(0, 50);

  // bound reasonCodes
  next.reasonCodes = next.reasonCodes.slice(0, 20);

  // ---- compare for noop
  const prevCanon = prevDoc ? { ...prevDoc } : null;
  const nextCanon = { ...next };

  // updatedAt should not trigger noop detection
  if (prevCanon && typeof prevCanon === "object") delete (prevCanon as any).updatedAt;
  delete (nextCanon as any).updatedAt;

  const same = !!prevCanon && stableStringify(prevCanon) === stableStringify(nextCanon);

  return { next, changed: !same, reason: "merged" as const };
}

// NOTE: This file is intentionally impure. It may import Firestore/admin later.
// For now we keep it minimal and do not implement actual writes until 6.3.3 wiring.

export type ExecuteWritePlanV1Input = {
  userId: string;
  out: RunCoreOnceOutput;       // contains rawEvent/doc, validatedFacts, haltungDelta
  plan: CoreWritePlanV1;
};

export async function executeWritePlanV1(
  input: ExecuteWritePlanV1Input
): Promise<PersistenceResultV1> {
  __EXECUTOR_CALLS__ += 1;

  const userId = String(input?.userId ?? "").trim();
  if (!userId) {
    return { wrote: false, reason: "failed", error: { message: "executeWritePlanV1: userId missing" } };
  }

  const plan = input.plan;

  const wantsRawEvent = plan.rawEvent === "append";
  const wantsFacts = plan.facts.mode === "upsert" && (plan.facts.count ?? 0) > 0;
  const wantsHaltung = plan.haltung.mode === "set_state" && (plan.haltung.keys?.length ?? 0) > 0;

  const wantsDailyDigest =
  plan.dailyDigest.mode === "merge" && plan.dailyDigest.count > 0;

  // Minimal noop fast-path
  if (!wantsRawEvent && !wantsFacts && !wantsHaltung && !wantsDailyDigest) {
    return {
      wrote: false,
      reason: "noop",
      counts: {
  rawEventsAppended: 0,
  factsUpserted: 0,
  haltungPatched: 0,
  historyAppended: 0,
  evidenceAppended: 0,
  dailyDigestMerged: 0,
},
    };
  }

  try {

  // We write exactly what the plan allows. Nothing else.
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const batch = db.batch();

  let rawEventsAppended = 0;
  let factsUpserted = 0;
  let haltungPatched = 0;
  let historyAppended = 0;
  let evidenceAppended = 0;
  let dailyDigestMerged = 0;

  if (wantsRawEvent) {
  const { rawEventId, doc } = input.out.rawEvent;
  const ref = rawEventRef(userId, rawEventId);

  // Idempotenz: wenn rawEvent bereits existiert und identisch ist -> NICHT schreiben
  const snap = await ref.get();
  if (snap.exists) {
    const prev = snap.data();
    const same = stableStringify(prev) === stableStringify(doc);
    if (!same) {
      batch.set(ref, doc, { merge: false });
      rawEventsAppended = 1;
    }
  } else {
    batch.set(ref, doc, { merge: false });
    rawEventsAppended = 1;
  }
}

  if (wantsFacts) {
  // Upsert NUR für Facts, die laut factsDiff "new" sind
  const upserts = Array.isArray(input.out.validatedFacts)
  ? input.out.validatedFacts
  : [];

  // Preload existing docs once (NOOP / idempotency)
  const refs = upserts.map((f) => factRef(userId, String(f.factId)));
  const snaps = refs.length > 0 ? await db.getAll(...refs) : [];

  const existingById = new Map<string, any>();
  for (const s of snaps) {
    existingById.set(s.id, s.exists ? s.data() : null);
  }

  for (const f of upserts) {
    const factId = String(f.factId);
    const ref = factRef(userId, factId);

    const prev = existingById.get(factId) ?? null;
    const now = Date.now();

    // Base doc ohne volatile Felder
    const nextBase: any = {
      factId,
      entityId: f.entityId,
      domain: f.domain,
      key: f.key,
      value: f.value,
      validity: f.validity ?? null,
      meta: f.meta ? stripUndefinedDeep(f.meta) : null,
      source: f.source ?? "raw_event",
      sourceRef: f.sourceRef ?? input.out.rawEvent.rawEventId,
      conflict: !!f.conflict,

      // createdAt stabil halten wenn vorhanden
      createdAt: typeof prev?.createdAt === "number" ? prev.createdAt : now,
    };

    const prevCanon = canonicalizeFactDocForNoop(prev);
    const nextCanon = canonicalizeFactDocForNoop(nextBase);

    const same =
      !!prev && stableStringify(prevCanon) === stableStringify(nextCanon);

    if (same) {
      // ✅ NOOP: NICHT schreiben, updatedAt bleibt stabil
      continue;
    }

    // Nur wenn wir wirklich schreiben: updatedAt setzen
    const nextDoc = { ...nextBase, updatedAt: now };

// ✅ evId SOFORT berechnen (wir brauchen es für supersedes)
const evId = buildEvidenceId({ factId, sourceRef: String(nextDoc.sourceRef) });

// Fact schreiben
batch.set(ref, nextDoc, { merge: true });
factsUpserted += 1;

// ✅ Supersedes: wenn UPDATE, dann alte Evidence markieren
if (prev && typeof (prev as any)?.sourceRef === "string" && String((prev as any).sourceRef).trim()) {
  const prevEvId = buildEvidenceId({ factId, sourceRef: String((prev as any).sourceRef) });

  // Nur superseden, wenn es wirklich eine andere Evidence ist
  if (prevEvId !== evId) {
    batch.set(
      evidenceRef(userId, prevEvId),
      {
        supersededBy: evId,
        supersededAt: now,
      },
      { merge: true }
    );
  }
}

// Neue Evidence schreiben
batch.set(
  evidenceRef(userId, evId),
  {
    evidenceId: evId,
    factId,
    entityId: nextDoc.entityId,
    domain: nextDoc.domain,
    key: nextDoc.key,
    sourceRef: nextDoc.sourceRef,
    rawEventId: input.out.rawEvent.rawEventId,
    createdAt: now,

    // optional aber sauber:
    supersededBy: null,
    supersededAt: null,
  },
  { merge: false }
);

evidenceAppended += 1;

const isUpdate = !!prev;

// 1) Wenn Update: schreibe ein "superseded"-History-Event für den alten Stand
if (isUpdate) {
  const prevSourceRef = String((prev as any)?.sourceRef ?? "").trim();

  // prevSourceRef sollte da sein (bei dir ist sourceRef normalerweise rawEventId),
  // aber wir sind defensiv und schreiben superseded nur wenn vorhanden.
  if (prevSourceRef) {
    const supersededHistoryId = buildHistoryId({
      factId,
      sourceRef: prevSourceRef,
      kind: "superseded",
    });

    batch.set(
      factHistoryRef(userId, supersededHistoryId),
      {
        historyId: supersededHistoryId,
        factId,
        entityId: nextDoc.entityId,
        domain: nextDoc.domain,
        key: nextDoc.key,
        kind: "superseded",
        prev: canonicalizeFactDocForNoop(prev),
        next: null,
        sourceRef: prevSourceRef,
        supersededBySourceRef: nextDoc.sourceRef,
        createdAt: now,
      },
      { merge: false }
    );

    historyAppended += 1;
  }
}

// 2) Immer: "created" oder "updated"-History-Event für den neuen Stand
const kind: "created" | "updated" = isUpdate ? "updated" : "created";

const historyId = buildHistoryId({
  factId,
  sourceRef: String(nextDoc.sourceRef),
  kind,
});

batch.set(
  factHistoryRef(userId, historyId),
  {
    historyId,
    factId,
    entityId: nextDoc.entityId,
    domain: nextDoc.domain,
    key: nextDoc.key,
    kind,
    prev: isUpdate ? canonicalizeFactDocForNoop(prev) : null,
    next: canonicalizeFactDocForNoop(nextDoc),
    sourceRef: nextDoc.sourceRef,
    createdAt: now,
  },
  { merge: false }
);

historyAppended += 1;


    
  }
}

  if (wantsHaltung) {
  const now = Date.now();

  // Wir schreiben den *vollen* Zustand (State), nicht nur den Patch.
  // Der State kommt aus dem Pure Core (`haltungDelta.after`), basierend auf `state.haltung`.
  batch.set(
    haltungRef(userId),
    {
      ...input.out.haltungDelta.after,
      updatedAt: now, // Storage-Timestamp darf impure sein
    },
    { merge: false } // State-Doc ist "single source of truth"
  );

  haltungPatched = 1;
}

if (wantsDailyDigest) {
    const now = Date.now();

    const dayBucket = dayBucketUTC(now);

    const rawEventId = String((input.out as any)?.rawEvent?.rawEventId ?? "").trim();

    const contributions = extractDigestContributions(input.out);

    if (rawEventId && contributions.length > 0) {
      const key = digestMetaKeyForDay(dayBucket);
      const ref = db
        .collection("brain")
        .doc(userId)
        .collection("meta")
        .doc(key);

      const snap = await ref.get();
      const prev = snap.exists ? snap.data() : null;

      const merged = mergeDailyDigestDocs({
        prev,
        dayBucket,
        rawEventId,
        contributions,
        now,
      });

      if (merged.changed && merged.next) {
        // merge:true ist ok, aber wir schreiben "full doc" anyway
        batch.set(ref, merged.next, { merge: true });
        dailyDigestMerged = 1;
      }
    }
  }

const totalWrites =
  rawEventsAppended +
  factsUpserted +
  haltungPatched +
  historyAppended +
  evidenceAppended +
  dailyDigestMerged;

if (totalWrites === 0) {
  return {
    wrote: false,
    reason: "noop",
    counts: {
      rawEventsAppended: 0,
      factsUpserted: 0,
      haltungPatched: 0,
      historyAppended: 0,
      evidenceAppended: 0,
      dailyDigestMerged: 0,
    },
  };
}

  await batch.commit();

  return {
    wrote: true,
    reason: "executed",
    counts: {
  rawEventsAppended,
  factsUpserted,
  haltungPatched,
  historyAppended,
  evidenceAppended,
  dailyDigestMerged,
},
  };
} catch (e: any) {
  return {
    wrote: false,
    reason: "failed",
    error: { message: String(e?.message ?? e) },
  };
}
}