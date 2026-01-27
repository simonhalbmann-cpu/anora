// functions/src/entry/indexingHandler.ts
import type { Request, Response } from "express";

import { indexingEntityResolverV1 } from "../indexing/entities/resolverAdapter";
import { runAllExtractorsOnRawEventV1Core } from "../indexing/runner/runAllExtractorsOnRawEventV1";
import { runExtractorOnRawEventV1Core } from "../indexing/runner/runExtractorOnRawEventV1";

function asString(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

type LoggerLike = {
  error: (message: string, meta?: any) => void;
  info?: (message: string, meta?: any) => void;
  warn?: (message: string, meta?: any) => void;
};

function isEmulator(): boolean {
  const inEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  const forcedOff = process.env.DEV_FORCE_DISABLE === "true";
  return inEmulator && !forcedOff;
}

function requireIndexingAccessOr403(req: Request, res: Response): boolean {
  try {
    // 1) Emulator: erlaubt (außer forced-off)
    if (isEmulator()) return true;

    // 2) Prod: Secret muss gesetzt sein
    const secret = process.env.INDEXING_API_SECRET || process.env.DEV_API_SECRET;
    if (!secret) {
      res.status(500).json({ ok: false, error: "INDEXING_API_SECRET/DEV_API_SECRET not set" });
      return false;
    }

    // 3) Token nur über Header oder Query (Body ist unsicher/unklar)
    const headerVal = req.header("x-indexing-secret");
    const headerToken = typeof headerVal === "string" ? headerVal : "";

    const queryAny = req.query as any;
    const queryToken =
      typeof queryAny?.indexingSecret === "string"
        ? String(queryAny.indexingSecret)
        : "";

    const token = headerToken || queryToken;

    if (!token || token !== secret) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return false;
    }

    return true;
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: "Indexing guard failed",
      detail: String(e),
    });
    return false;
  }
}

export function createIndexingHandler(deps: { logger: LoggerLike }) {
  const { logger } = deps;

  return async function indexingHandler(req: Request, res: Response): Promise<void> {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Only POST allowed" });
        return;
      }

      if (!requireIndexingAccessOr403(req, res)) return;

      let body: any = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          res.status(400).json({ ok: false, error: "Invalid JSON body" });
          return;
        }
      }

      const path = String((req as any).path ?? req.url ?? "").split("?")[0];

      // POST /runAll
      if (path.endsWith("/runAll")) {
        const userId = asString(body?.userId).trim();
        const rawEventId = asString(body?.rawEventId).trim();
        const raw = body?.raw;

        const extractorIds = Array.isArray(body?.extractorIds)
          ? body.extractorIds
          : undefined;

        if (!userId || !rawEventId || !raw) {
          res.status(400).json({
            ok: false,
            error: "Missing userId or rawEventId or raw (RawEventDoc)",
          });
          return;
        }

        const out = await runAllExtractorsOnRawEventV1Core(
          { userId, rawEventId, raw, extractorIds },
          { entityResolver: indexingEntityResolverV1 }
        );

        res.status(200).json({ ok: true, out });
        return;
      }

      // POST /runOne
      if (path.endsWith("/runOne")) {
        const userId = asString(body?.userId).trim();
        const rawEventId = asString(body?.rawEventId).trim();
        const extractorId = asString(body?.extractorId).trim();
        const raw = body?.raw;

        if (!userId || !rawEventId || !extractorId || !raw) {
          res.status(400).json({
            ok: false,
            error: "Missing userId or rawEventId or extractorId or raw (RawEventDoc)",
          });
          return;
        }

        const out = await runExtractorOnRawEventV1Core(
          { userId, rawEventId, extractorId, raw },
          { entityResolver: indexingEntityResolverV1 }
        );

        res.status(200).json({ ok: true, out });
        return;
      }

      res.status(404).json({ ok: false, error: "Unknown indexing route" });
    } catch (err) {
      logger.error("indexingHandler_failed", { error: String(err) });
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  };
}