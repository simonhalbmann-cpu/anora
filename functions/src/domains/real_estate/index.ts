// functions/src/domains/real_estate/index.ts

import {
    INGEST_SYSTEM_PROMPT_DE,
    INGEST_SYSTEM_PROMPT_DE_VERSION,
    logger,
    openai,
    safeParseAssistantJson,
    saveNewFacts,
    updateMietrechtContextFromFacts,
    validateIngestFacts,
} from "../../core/bridge";

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

export async function ingestRealEstateDocumentText(
  ctx: RealEstateContext,
  req: RealEstateIngestRequest
): Promise<RealEstateIngestResult> {
  // Schritt 1.3.2: wir verschieben die bestehende Logik hierher
  // (OpenAI Call + Parse + validateIngestFacts + saveNewFacts + updateMietrechtContextFromFacts)
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

  // NOTE: OpenAI + Helpers sind aktuell noch im Core verfügbar.
  // In Schritt 1.4.4 ziehen wir die benötigten Imports sauber nach.
  
  logger.info("openai_call_ingestDocumentText", {
    userId: ctx.userId,
    
    promptVersion: INGEST_SYSTEM_PROMPT_DE_VERSION,
    model: "gpt-4o-mini",
  });

  
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      
      { role: "system", content: INGEST_SYSTEM_PROMPT_DE },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "[]";
  
  const parsed = safeParseAssistantJson(raw);

  if (!parsed || !Array.isArray(parsed)) {
    
    logger.error("ingestDocumentText_invalid_ai_output", { raw });
    throw new Error("KI-Antwort war kein gültiges JSON-Array.");
  }

  // ✅ Zentrale Validation (Schema + Safety + Tags)
  
  const newFacts = validateIngestFacts(
    ctx.userId,
    parsed,
    { filename: req.meta.filename, source: req.meta.source },
    { maxFacts: 50 }
  );

  if (newFacts.length === 0) {
    
    logger.warn("ingestDocumentText_no_valid_facts", { userId: ctx.userId });
    return { factsSaved: 0 };
  }

  
  await saveNewFacts(ctx.userId, newFacts);

  // 1.3/3: Mietrechts-Kontext aus Dokument-Facts + Meta ableiten
  
  await updateMietrechtContextFromFacts(ctx.userId, newFacts, {
    filename: req.meta.filename,
    source: req.meta.source,
  });

  return { factsSaved: newFacts.length };
}