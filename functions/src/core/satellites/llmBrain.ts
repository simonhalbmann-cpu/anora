// functions/src/core/satellites/llmBrain.ts

// ❌ NOT CORE
// Satellites may read facts but must never:
// - rank
// - prioritize
// - aggregate
// - store
/**
 * PHASE 5.x FINAL: Satellite (LLM Brain) – baut Prompt + ruft Modell.
 * FINAL RULE: Reply-only. newFacts ist IMMER [].
 */

import type { CoreInterventionV1 } from "../interventions/types";
import { logger } from "../logging/logger";
import {
  assertSatelliteReplyMatchesInterventionV1,
  buildInterventionDirectiveV1,
} from "./interventionContract";
import type { BrainInput, BrainOutput } from "./types";

export type LlmBrainDeps = {
  openai: any;
  model: string;

  // System Prompt für Satellite (BRAIN_*)
  systemPrompt: string;
  systemPromptVersion?: string;

  // Prompt-Limits
  maxFactsPerPrompt: number;
  maxKnowledgeSummaryLength: number;
  maxHistoryTurns: number;
  maxHistorySummaryLength: number;

  safeParseAssistantJson: (raw: string) => { ok: boolean; value?: any; error?: string; jsonCandidate?: string };

  fallbackCopy: {
    invalidJson: string;
    genericError: string;
  };
};

export async function runLlmBrainSatellite(
  deps: LlmBrainDeps,
  input: BrainInput,
  core?: { intervention?: CoreInterventionV1 }
): Promise<BrainOutput> {
  const { userId, userName, message, knowledge, history, contexts } = input;

  const normalizedHistory = Array.isArray(history) ? history : [];

  const roleLabelForPrompt = (role: string) =>
    role === "user" ? "Nutzer" : "Anora";

  const namePart = userName ? `Der Nutzer heißt ${userName}.` : "";

  const knowledgeSummaryRaw =
    knowledge.length === 0
      ? "Bisher sind noch keine Fakten gespeichert."
      : knowledge
          .slice(-deps.maxFactsPerPrompt)
          .map((f: any) => {
            const raw = f.raw || "";
            const t = f.type || "generic";
            return `• [${t}] ${raw}`;
          })
          .join("\n");

  const knowledgeSummary =
    knowledgeSummaryRaw.length > deps.maxKnowledgeSummaryLength
      ? knowledgeSummaryRaw.slice(0, deps.maxKnowledgeSummaryLength) + "\n[GEKÜRZT]"
      : knowledgeSummaryRaw;

  const lastTurnsRaw =
    normalizedHistory.length === 0
      ? "Noch kein bisheriger Chatverlauf."
      : normalizedHistory
          .slice(-deps.maxHistoryTurns)
          .map((m: any) => {
            const role = String(m?.role ?? "");
            const text = typeof m?.text === "string" ? m.text : "";
            return `${roleLabelForPrompt(role)}: ${text}`;
          })
          .join("\n");

  const lastTurns =
    lastTurnsRaw.length > deps.maxHistorySummaryLength
      ? lastTurnsRaw.slice(0, deps.maxHistorySummaryLength) + "\n[GEKÜRZT]"
      : lastTurnsRaw;

  const safeMessage = typeof message === "string" ? message : "";

  const interventionLevel = core?.intervention?.level ?? "observe";
  const interventionDirective = buildInterventionDirectiveV1(interventionLevel);

  const coreInterventionLine =
    core?.intervention
      ? `Core-Intervention (intern): level=${core.intervention.level}; reasons=${core.intervention.reasonCodes.join(",")}`
      : "Core-Intervention (intern): none";

  const contextSummary = (() => {
    try {
      return contexts ? JSON.stringify(contexts).slice(0, 4000) : "(keine)";
    } catch {
      return "(contexts stringify failed)";
    }
  })();

  const userPrompt = `
Nutzer-ID: ${userId}
${namePart}

${coreInterventionLine}

# Bisherige Unterhaltung:
${lastTurns}

# Aktuelle Kontexte:
${contextSummary}

# Bereits gespeichertes Wissen:
${knowledgeSummary}

WICHTIG:
- Du gibst NUR ein JSON zurück.
- Keys: reply,newFacts,actions,tasks
- reply ist ein String.
- newFacts/actions/tasks sind Arrays.
- Folge der LETZTEN Instruktion, die innerhalb der Nutzer-Nachricht steht.

# Neue Nachricht (das ist der letzte Prompt-Teil, danach kommt nichts mehr):
"${safeMessage}"
`.trim();

  try {
    logger.info("openai_call_runServerBrain", {
      userId,
      promptVersion: deps.systemPromptVersion ?? "unknown",
      model: deps.model,
    });

    const completion = await deps.openai.chat.completions.create({
      model: deps.model,
      messages: [
  { role: "system", content: deps.systemPrompt },
  { role: "system", content: interventionDirective },
  { role: "user", content: userPrompt },
],
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    logger.info("llmBrain_raw_response", { userId, rawPreview: raw.slice(0, 200) });

    const parsed = deps.safeParseAssistantJson(raw);

// 1) Parse muss ok sein
if (!parsed?.ok) {
  logger.error("llmBrain_parse_failed", {
    userId,
    error: parsed?.error ?? "unknown",
    jsonCandidate: parsed?.jsonCandidate ?? "",
    rawPreview: raw.slice(0, 500),
  });
  return { reply: deps.fallbackCopy.invalidJson, newFacts: [], actions: [], tasks: [] };
}

const obj = parsed.value;

// 2) obj muss Objekt sein (kein Array)
if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
  logger.error("llmBrain_shape_invalid", {
    userId,
    typeofValue: typeof obj,
    isArray: Array.isArray(obj),
    jsonCandidate: parsed.jsonCandidate,
  });
  return { reply: deps.fallbackCopy.invalidJson, newFacts: [], actions: [], tasks: [] };
}

    // 2) reply muss nicht-leer sein
   const reply =
  typeof (obj as any).reply === "string" ? String((obj as any).reply).trim() : "";

    if (!reply) {
      return { reply: deps.fallbackCopy.invalidJson, newFacts: [], actions: [], tasks: [] };
    }

    // 3) Arrays defensiv normalisieren
    const actions = Array.isArray((obj as any).actions) ? (obj as any).actions : [];
const tasks = Array.isArray((obj as any).tasks) ? (obj as any).tasks : [];

    // 4) FINAL: newFacts ist IMMER leer (Satellite ist reply-only)
    const newFacts: any[] = [];

    // 5) Contract enforcement darf Function NICHT crashen → safe fallback
    try {
      assertSatelliteReplyMatchesInterventionV1(interventionLevel, reply);
    } catch (e) {
      logger.warn("satellite_contract_violation", {
        userId,
        level: interventionLevel,
        error: String(e),
      });
      return { reply: deps.fallbackCopy.invalidJson, newFacts: [], actions: [], tasks: [] };
    }

    return { reply, newFacts, actions, tasks };
  } catch (err) {
    logger.error("runLlmBrainSatellite_failed", { userId, error: String(err) });
    return { reply: deps.fallbackCopy.genericError, newFacts: [], actions: [], tasks: [] };
  }
}