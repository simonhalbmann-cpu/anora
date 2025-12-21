/**
 * PHASE 5.2: Satellite (LLM Brain) – baut Prompt + ruft Modell.
 * Core bleibt sauber: bekommt nur intervention-output, nicht rohe Haltung.
 */

import * as logger from "firebase-functions/logger";

// ⚠️ Passe den Import an, falls BrainInput/BrainOutput nicht aus ../../index kommen.
import type { BrainInput, BrainOutput } from "./types";

export type LlmBrainDeps = {
  openai: any;
  model: string;
  systemPrompt: string;
  systemPromptVersion?: string;

  maxFactsPerPrompt: number;
  maxKnowledgeSummaryLength: number;
  maxHistoryTurns: number;
  maxHistorySummaryLength: number;
  maxUserMessageLength: number;

  safeParseAssistantJson: (raw: string) => any;

  validateIngestFacts: (
    userId: string,
    parsed: any,
    safeMeta: { filename?: string | null; source?: string | null },
    opts?: { maxFacts?: number }
  ) => any[];

  fallbackCopy: {
    missingApiKey: string;
    invalidJson: string;
    genericError: string;
  };
};

export async function runLlmBrainSatellite(
  deps: LlmBrainDeps,
  input: BrainInput,
  core?: { intervention?: { level: string; reasonCodes: string[] } }
): Promise<BrainOutput> {
  const { userId, userName, message, knowledge, history, contexts } = input;

  // ------------------------------------------------------------
  // History-Normalisierung:
  // - akzeptiert "user" | "anora" | "assistant"
  // - für Prompt-Text labeln wir "anora"/"assistant" als "Anora"
  // - für OpenAI-Messages (falls später genutzt) mappen wir "anora" -> "assistant"
  // ------------------------------------------------------------
  const normalizedHistory = Array.isArray(history) ? history : [];

  const roleLabelForPrompt = (role: string) =>
    role === "user" ? "Nutzer" : "Anora";

  const roleForOpenAi = (role: string) =>
    role === "anora" ? "assistant" : role; // nur für später relevant

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

  const truncatedMessage =
    typeof message === "string" ? message.slice(0, deps.maxUserMessageLength) : "";

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

# Neue Nachricht:
"${truncatedMessage}"

Bitte gib NUR ein JSON im beschriebenen Format zurück.
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
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = deps.safeParseAssistantJson(raw);

    if (!parsed || typeof parsed !== "object") {
      return { reply: deps.fallbackCopy.invalidJson, newFacts: [], actions: [], tasks: [] };
    }

    const newFacts = deps.validateIngestFacts(
      userId,
      Array.isArray(parsed.newFacts) ? parsed.newFacts : [],
      { filename: null, source: null },
      { maxFacts: 50 }
    );

    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      newFacts,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch (err) {
    logger.error("runLlmBrainSatellite_failed", { userId, error: String(err) });
    return { reply: deps.fallbackCopy.genericError, newFacts: [], actions: [], tasks: [] };
  }
}