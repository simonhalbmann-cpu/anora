// functions/src/core/safety/sanitizeBrainOutput.ts

import * as logger from "firebase-functions/logger";
import { FALLBACK_COPY_DE } from "../../copy/anoraCopy.de";
import type { BrainOutput } from "../satellites/types";

const MAX_REPLY_LENGTH = 2000;

export function sanitizeBrainOutput(output: BrainOutput): BrainOutput {
  let reply = typeof output.reply === "string" ? output.reply : "";

  if (reply.length > MAX_REPLY_LENGTH) {
    logger.warn("anora_reply_truncated", {
      originalLength: reply.length,
      cappedAt: MAX_REPLY_LENGTH,
    });
    reply = reply.slice(0, MAX_REPLY_LENGTH);
  }

  if (!reply.trim()) {
    logger.warn("anora_empty_reply_fallback_used");
    reply = FALLBACK_COPY_DE.emptyReplyFallback;
  }

  const newFacts = Array.isArray(output.newFacts) ? output.newFacts : [];
  const actions = Array.isArray(output.actions) ? output.actions : [];
  const tasks = Array.isArray(output.tasks) ? output.tasks : [];

  return { reply, newFacts, actions, tasks };
}