import type { Request, Response } from "express";

import type { CoreHaltungV1 } from "../core/haltung/types";

import {
  runCoreWithPersistence,
  type RunCoreWithPersistenceInput,
} from "../core/runCoreWithPersistence";

import { runLlmBrainSatellite } from "../core/satellites/llmBrain";
import type { BrainInput } from "../core/satellites/types";

import {
  BRAIN_SYSTEM_PROMPT_DE,
  BRAIN_SYSTEM_PROMPT_DE_VERSION,
} from "../prompt";

type LoggerLike = {
  error: (msg: string, meta?: any) => void;
  info?: (msg: string, meta?: any) => void;
  warn?: (msg: string, meta?: any) => void;
};

type OpenAIClientLike = {
  chat: {
    completions: {
      create: (args: any) => Promise<any>;
    };
  };
};

export type ApiHandlerDeps = {
  logger: LoggerLike;

  // impure deps, injected from index.ts
  getOpenAI: () => OpenAIClientLike;
  safeParseAssistantJson: (raw: string) => any;

  // optional: read current haltung from storage (impure)
  readHaltung?: (userId: string) => Promise<CoreHaltungV1 | undefined>;

  // model config
  model: string;
};

function asString(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function clamp01(n: any, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

function normalizeHaltungDoc(d: any): CoreHaltungV1 {
  return {
    version: 1,
    directness: clamp01(d?.directness, 0.5),
    interventionDepth: clamp01(d?.interventionDepth, 0.5),
    patience: clamp01(d?.patience, 0.5),
    escalationThreshold: clamp01(d?.escalationThreshold, 0.7),
    reflectionLevel: clamp01(d?.reflectionLevel, 0.5),
    updatedAt: typeof d?.updatedAt === "number" ? d.updatedAt : 0,
  };
}

export function createApiHandler(deps: ApiHandlerDeps) {
  return async function apiHandler(req: Request, res: Response): Promise<void> {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Only POST allowed" });
        return;
      }

      // Body kann Objekt oder String sein
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

      const useSatellite = body?.useSatellite === true; // default false
      const userName =
        typeof body?.userName === "string" ? body.userName : undefined;

      if (!userId || !text) {
        res.status(400).json({ ok: false, error: "Missing userId or message" });
        return;
      }

      // Optional: Haltung laden (impure via deps.readHaltung)
      let haltung: CoreHaltungV1 | undefined = undefined;
      if (deps.readHaltung) {
        try {
          const raw = await deps.readHaltung(userId);
          haltung = raw ? normalizeHaltungDoc(raw as any) : undefined;
        } catch {
          haltung = undefined;
        }
      }

      const dryRun = body?.dryRun === true; // default false = writes
      const extractorIds = Array.isArray(body?.extractorIds)
        ? body.extractorIds
        : [];

      const input: RunCoreWithPersistenceInput = {
        userId,
        text,
        dryRun,
        extractorIds,
        state: {
          locale: asString(body?.state?.locale ?? "de-DE"),
          facts: Array.isArray(body?.state?.facts) ? body.state.facts : [],
          haltung,
        },
      };

      const llmDeps = {
        openai: deps.getOpenAI(),
        model: deps.model,

        systemPrompt: BRAIN_SYSTEM_PROMPT_DE,
        systemPromptVersion: BRAIN_SYSTEM_PROMPT_DE_VERSION,

        maxFactsPerPrompt: 30,
        maxKnowledgeSummaryLength: 4000,
        maxHistoryTurns: 12,
        maxHistorySummaryLength: 4000,
        maxUserMessageLength: 4000,

        safeParseAssistantJson: deps.safeParseAssistantJson,

        fallbackCopy: {
          invalidJson: "Antwort war kein gültiges JSON.",
          genericError: "Es ist ein Fehler passiert.",
        },
      } as const;

      const out = await runCoreWithPersistence(input);

// 🔒 HARTE TRENNUNG: Ingest / Golden Test = KEIN Brain
if (!useSatellite) {
  res.status(200).json({ ok: true, out });
  return;
}

// --- AB HIER NUR CHAT / BRAIN ---
let reply: string | null = null;

const brainInput: BrainInput = {
  userId,
  userName,
  message: text,
  knowledge: Array.isArray(body?.brain?.knowledge) ? body.brain.knowledge : [],
  history: Array.isArray(body?.brain?.history) ? body.brain.history : [],
  contexts: body?.brain?.contexts ?? null,
};

const interventionCandidate =
  (out as any)?.intervention ?? (out as any)?.core?.intervention ?? null;

const coreForSatellite =
  interventionCandidate ? { intervention: interventionCandidate } : undefined;

const brainOut = await runLlmBrainSatellite(
  llmDeps as any,
  brainInput,
  coreForSatellite
);

reply = brainOut.reply ?? "";

res.status(200).json({ ok: true, out, reply });
    } catch (err) {
      deps.logger.error("apiHandler_failed", { error: String(err) });
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  };
}