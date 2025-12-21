// functions/src/core/rawEvents/types.ts

export type RawEventSourceType = "ingest_document_text";

export type RawEventMeta = {
  filename: string | null;
  mimeType: string | null;
  source: string | null;
};

export type RawEventPayloadDocumentText = {
  text: string;
};

export type RawEventProcessingV1Status = "running" | "done" | "error";

export type RawEventProcessingV1 = {
  status: RawEventProcessingV1Status;

  runner: string; // z.B. "runAllExtractorsOnRawEventV1"
  extractorIds?: string[];

  startedAt?: number;
  finishedAt?: number;

  // z.B. { extractorCount, factsAccepted, upserted, skipped, warningsCount, perExtractor }
  stats?: Record<string, any>;

  error?: {
    message: string;
    stack?: string;
  };
};

export type RawEventProcessing = {
  v1?: RawEventProcessingV1;
};

export type RawEventDoc = {
  timestamp: number;
  sourceType: RawEventSourceType;

  userRef: string;
  locale: string | null;

  payload: RawEventPayloadDocumentText;
  meta: RawEventMeta;

  ingestHash: string;
  dayBucket: string;
  isDuplicate?: boolean;
  duplicateOf?: string | null;

  // Observability v0
  processing?: RawEventProcessing;

  // optional (falls du das später nutzen willst)
  note?: string | null;
};