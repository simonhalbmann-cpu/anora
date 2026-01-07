// functions/src/entry/httpHandler.ts

import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";

// Side-effect: registriert Extractors (Registry)
import "../core/facts/registryBootstrap";

import {
  runCoreWithPersistence,
  type RunCoreWithPersistenceInput,
} from "../core/runCoreWithPersistence";

function asString(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

export async function httpHandler(req: Request, res: Response): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Only POST allowed" });
      return;
    }

    // Body kann schon Objekt sein (Functions/Express), oder String (je nach Client)
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
    const text = asString(body?.message ?? body?.text).trim();

    if (!userId || !text) {
      res.status(400).json({ ok: false, error: "Missing userId or message" });
      return;
    }

    // Optional Controls (bewusst)
    const dryRun = body?.dryRun !== false; // default true
    const extractorIds =
      Array.isArray(body?.extractorIds) ? body.extractorIds : []; // default: satellites OFF

    const input: RunCoreWithPersistenceInput = {
      userId,
      text,
      dryRun,
      extractorIds,

      // Optional state (später holen wir facts/haltung aus Firestore)
      state: {
        locale: "de-DE",
        facts: [],
        // haltung: ... (später)
      },
    };

    const out = await runCoreWithPersistence(input);

    res.status(200).json({
      ok: true,
      out,
    });
  } catch (err) {
    logger.error("httpHandler_failed", { error: String(err) });
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
}