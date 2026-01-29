// functions/src/entry/digestHandler.ts
import type { Request, Response } from "express";
import admin from "firebase-admin";

import type { MetaContextDoc } from "../core/meta/contextStore";
import { getMetaContext } from "../core/meta/contextStore";
import { dayBucketInTimeZone, dayBucketUTC } from "../core/rawEvents/hash";

type LoggerLike = {
  error: (message: string, meta?: any) => void;
  info?: (message: string, meta?: any) => void;
  warn?: (message: string, meta?: any) => void;
};

function asString(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function clampInt(n: any, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(0, x);
}

function digestKeyForDay(dayBucket: string): string {
  return `dailyDigest_v1__${dayBucket}`;
}

function readCounts(doc: any): { processedLocal: number; blockedByTier: number; errors: number; contributionsCount: number } {
  const cc = clampInt(doc?.contributionsCount, 0);
  const c = doc?.counts ?? {};
  return {
    contributionsCount: cc,
    processedLocal: clampInt(c?.processedLocal, 0),
    blockedByTier: clampInt(c?.blockedByTier, 0),
    errors: clampInt(c?.errors, 0),
  };
}

export function createDigestHandler(deps: { logger: LoggerLike }) {
  const { logger } = deps;

  return async function digestHandler(req: Request, res: Response): Promise<void> {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Only POST allowed" });
        return;
      }

      let body: any = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          res.status(400).json({ ok: false, error: "Invalid JSON body" });
          return;
        }
      }

      const userId = asString(body?.userId).trim();
      const days = clampInt(body?.days, 7);
      const timeZone =
      typeof body?.timeZone === "string" && body.timeZone.trim()
      ? body.timeZone.trim()
      : "UTC";

      if (!userId) {
        res.status(400).json({ ok: false, error: "Missing userId" });
        return;
      }

      // Firestore init (defensiv)
      if (!admin.apps.length) admin.initializeApp();
      const db = admin.firestore();

      const now = Date.now();
      const dayBuckets: string[] = [];
for (let i = 0; i < Math.max(1, Math.min(31, days)); i++) {
  const ms = now - i * 24 * 60 * 60 * 1000;
  dayBuckets.push(
    timeZone === "UTC"
      ? dayBucketUTC(ms)
      : dayBucketInTimeZone(ms, timeZone)
  );
}

      const perDay: Array<{
        dayBucket: string;
        key: string;
        exists: boolean;
        counts: ReturnType<typeof readCounts>;
      }> = [];

      let totalBlockedByTier = 0;
      let totalProcessedLocal = 0;
      let totalErrors = 0;
      let totalContributions = 0;

      for (const dayBucket of dayBuckets) {
        const key = digestKeyForDay(dayBucket);
        const doc: MetaContextDoc | null = await getMetaContext(db as any, userId, key);

        if (!doc) {
          perDay.push({
            dayBucket,
            key,
            exists: false,
            counts: { contributionsCount: 0, processedLocal: 0, blockedByTier: 0, errors: 0 },
          });
          continue;
        }

        const counts = readCounts(doc);
        perDay.push({ dayBucket, key, exists: true, counts });

        totalContributions += counts.contributionsCount;
        totalProcessedLocal += counts.processedLocal;
        totalBlockedByTier += counts.blockedByTier;
        totalErrors += counts.errors;
      }

      // PHASE 5.3 – PRO NUDGE (NUR IM DIGEST, OHNE DRUCK)
      const proNudge =
        totalBlockedByTier > 0
          ? {
              blockedByTier: totalBlockedByTier,
              message: `${totalBlockedByTier} Dokumente wurden nicht analysiert (Pro)`,
            }
          : null;

      res.status(200).json({
        ok: true,
        digest: {
          version: 1,
          rangeDays: dayBuckets.length,
          toDay: dayBuckets[0], // today
          fromDay: dayBuckets[dayBuckets.length - 1],
          totals: {
            contributionsCount: totalContributions,
            processedLocal: totalProcessedLocal,
            blockedByTier: totalBlockedByTier,
            errors: totalErrors,
          },
          proNudge, // null => Client zeigt nichts
          days: perDay, // bounded by max 31
        },
      });
    } catch (err) {
      logger.error("digestHandler_failed", { error: String(err) });
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  };
}