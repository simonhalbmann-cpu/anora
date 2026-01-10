// functions/src/domains/real_estate/index.ts

import { validateIngestFacts } from "../../ingest/validateIngestFacts";

export type RealEstateContext = {
  userId: string;
  locale?: string; // z.B. "de-DE"
};

export type RealEstateIngestMeta = {
  filename: string | null;
  mimeType: string | null;
  source: string | null;
};

export type RealEstateIngestRequest = {
  text: string;
  meta: RealEstateIngestMeta;
};

export type RealEstateIngestResult = {
  factsSaved: number;
};

export type RealEstateIngestDeps = {
  logger: {
    info: (msg: string, meta?: any) => void;
    warn: (msg: string, meta?: any) => void;
    error: (msg: string, meta?: any) => void;
  };

  // liefert raw AI content (string)
  callLLM: (args: {
    model: string;
    temperature: number;
    system: string;
    user: string;
  }) => Promise<string>;

  // robustes JSON-Parsing (dein existing Helper, aber injected)
  safeParseAssistantJson: (raw: string) => any;

  // persistence + context update (existing core funcs, aber injected)
  saveNewFacts: (userId: string, facts: any[]) => Promise<void>;
  updateMietrechtContextFromFacts: (
    userId: string,
    facts: any[],
    meta: { filename: string | null; source: string | null }
  ) => Promise<void>;

  // prompts injected (damit Domain nicht mehr bridge anfassen muss)
  prompts: {
    INGEST_SYSTEM_PROMPT_DE: string;
    INGEST_SYSTEM_PROMPT_DE_VERSION: string;
  };

  // model injected (oder fix, aber besser injected)
  model: string;
};

export function createRealEstateIngestService(deps: RealEstateIngestDeps) {
  return {
    ingestRealEstateDocumentText: async (
      ctx: RealEstateContext,
      req: RealEstateIngestRequest
    ): Promise<RealEstateIngestResult> => {
      const cleanText =
        req.text.length > 15000
          ? req.text.slice(0, 15000) + "\n\n[TEXT GEKÜRZT]"
          : req.text;

      const userPrompt = `
Meta:
- filename: ${req.meta.filename ?? "unbekannt"}
- mimeType: ${req.meta.mimeType ?? "unbekannt"}
- source: ${req.meta.source ?? "unbekannt"}

Dokumenttext (Deutsch oder gemischt):
"""${cleanText}"""
`;

      deps.logger.info("openai_call_ingestDocumentText", {
        userId: ctx.userId,
        promptVersion: deps.prompts.INGEST_SYSTEM_PROMPT_DE_VERSION,
        model: deps.model,
      });

      const raw = await deps.callLLM({
        model: deps.model,
        temperature: 0.1,
        system: deps.prompts.INGEST_SYSTEM_PROMPT_DE,
        user: userPrompt,
      });

      const parsed = deps.safeParseAssistantJson(raw);

      if (!parsed || !Array.isArray(parsed)) {
        deps.logger.error("ingestDocumentText_invalid_ai_output", { raw });
        throw new Error("KI-Antwort war kein gültiges JSON-Array.");
      }

      const newFacts = validateIngestFacts(
        ctx.userId,
        parsed,
        { filename: req.meta.filename, source: req.meta.source },
        { maxFacts: 50 }
      );

      if (newFacts.length === 0) {
        deps.logger.warn("ingestDocumentText_no_valid_facts", {
          userId: ctx.userId,
        });
        return { factsSaved: 0 };
      }

      await deps.saveNewFacts(ctx.userId, newFacts);

      await deps.updateMietrechtContextFromFacts(ctx.userId, newFacts, {
        filename: req.meta.filename,
        source: req.meta.source,
      });

      return { factsSaved: newFacts.length };
    },
  };
}