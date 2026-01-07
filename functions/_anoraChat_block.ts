export const anoraChat = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST allowed" });
      return;
    }

    const body = req.body as {
      userId?: string;
      userName?: string | null;
      message?: string;
      history?: BrainChatMessage[];
    };

    // ðŸ” Eingangs-HÃ¤rtung: userId & message
    if (!body) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    // userId validieren (Typ, LÃ¤nge, erlaubte Zeichen)
    if (typeof body.userId !== "string") {
      res.status(400).json({ error: "Missing or invalid userId" });
      return;
    }

    const userId = body.userId.trim();
    const userIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

    if (!userIdPattern.test(userId)) {
      logger.warn("Invalid userId pattern", { rawUserId: body.userId });
      res.status(400).json({ error: "Invalid userId format" });
      return;
    }

    // Hinweis: In der finalen Version sollte userId aus einer
    // vertrauenswÃ¼rdigen Auth-Quelle (z.B. Firebase Auth UID) stammen
    // und NICHT nur aus dem Body Ã¼bernommen werden.

    // message basic check
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      res.status(400).json({ error: "Missing or invalid message" });
      return;
    }

    const knowledge = await loadKnowledge(userId);
    const contexts: BrainContexts = (await loadBrainContexts(userId)) || {};

const safeUserName: string | null =
  typeof body.userName === "string" ? body.userName : null;

    const input: BrainInput = {
      userId,
      userName: safeUserName,
      message: body.message,
      history: Array.isArray(body.history) ? body.history : [],
      knowledge,
      contexts,
    };

    // ------------------------------------------------------------
// PHASE 3.1: Core-Haltung laden (intern, numerisch)
// ------------------------------------------------------------
const haltung = await getOrCreateCoreHaltungV1(userId);

// ------------------------------------------------------------
// PHASE 3.2: deterministische Trigger aus aktueller Nachricht
// (noch keine Wirkung â€“ nur Observability)
// ------------------------------------------------------------
const triggerRes = computeHaltungTriggersFromMessage({
  message: input.message,
});

logger.info("core_haltung_triggers_v1", {
  userId,
  hasTrigger: triggerRes.hasTrigger,
  triggers: triggerRes.triggers,
});


// ------------------------------------------------------------
// PHASE 4.1: deterministische Intervention ableiten (Core)
// (noch keine Wirkung â€“ nur Observability)
// ------------------------------------------------------------
const intervention = computeCoreInterventionV1({
  message: input.message,
  haltung,
  triggerRes,
});

logger.info("core_intervention_v1", {
  userId,
  level: intervention.level,
  reasonCodes: intervention.reasonCodes,
  debug: intervention.debug,
});

// ------------------------------------------------------------
// PHASE 3.3: Lernlogik (NUR explizites Feedback, sonst NO-OP)
// ------------------------------------------------------------
try {
  const learn = await applyHaltungLearningIfAny({
    userId,
    message: input.message,
  });

  if (learn.applied) {
    logger.info("core_haltung_learning_applied_v1", {
      userId,
      reason: learn.reason,
      patch: learn.patch,
    });
  } else {
    logger.info("core_haltung_learning_noop_v1", {
      userId,
    });
  }
} catch (err) {
  // Lernlogik darf Core nicht killen
  logger.warn("core_haltung_learning_failed_v1", {
    userId,
    error: String(err),
  });
}

// ------------------------------------------------------------
// PHASE 3.3: Lernlogik (nur explizites Feedback, deterministisch)
// ------------------------------------------------------------
const learningEvent = detectHaltungLearningEventFromMessage(input.message);

if (learningEvent) {
  const patch = deriveHaltungPatchFromEvent(haltung, learningEvent);

  // Patch nur anwenden, wenn wirklich etwas geÃ¤ndert wÃ¼rde
  if (Object.keys(patch).length > 0) {
    const next = await patchCoreHaltungV1(userId, patch);

    logger.info("core_haltung_learn_applied_v1", {
      userId,
      event: learningEvent.type,
      patch,
      before: {
        directness: haltung.directness,
        interventionDepth: haltung.interventionDepth,
        patience: haltung.patience,
        escalationThreshold: haltung.escalationThreshold,
        reflectionLevel: haltung.reflectionLevel,
      },
      after: {
        directness: next.directness,
        interventionDepth: next.interventionDepth,
        patience: next.patience,
        escalationThreshold: next.escalationThreshold,
        reflectionLevel: next.reflectionLevel,
      },
    });
  }
} else {
  logger.info("core_haltung_learn_none_v1", {
    userId,
    msgPreview: String(input.message || "").slice(0, 120),
  });
}

   // 1) Spezialfall: Fragen nach konkreten MietbetrÃ¤gen / -erhÃ¶hungen
const rentAnswer = await answerRentQuestionIfPossibleV2(input);
if (rentAnswer) {
  const safeRentAnswer = sanitizeBrainOutput(rentAnswer);
  res.status(200).json(safeRentAnswer);
  return;
}

    // 2) Standard-KI-Flow
    logger.info("anoraChat_request", {
      userId: input.userId,
      message: input.message,
      knowledgeCount: input.knowledge.length,
    });


    logger.info("DEBUG_contexts_before_prompt", {
  userId,
  propertyContext: contexts.property,
  knowledgeCount: knowledge.length,
  firstKnowledge: knowledge[0] ?? null,
});

  
    const result = await runLlmBrainSatellite(
  {
    openai,
    model: "gpt-4o-mini",
    systemPrompt: SYSTEM_PROMPT_DE,
    systemPromptVersion: SYSTEM_PROMPT_DE_VERSION,
    maxFactsPerPrompt: MAX_FACTS_PER_PROMPT,
    maxKnowledgeSummaryLength: MAX_KNOWLEDGE_SUMMARY_LENGTH,
    maxHistoryTurns: MAX_HISTORY_TURNS,
    maxHistorySummaryLength: MAX_HISTORY_SUMMARY_LENGTH,
    maxUserMessageLength: MAX_USER_MESSAGE_LENGTH,
    safeParseAssistantJson,
    validateIngestFacts,
    fallbackCopy: FALLBACK_COPY_DE,
  },
  input,
  {
    intervention: {
      level: intervention.level,
      reasonCodes: intervention.reasonCodes,
    },
  }
);

    // Safety-Layer anwenden (AntwortlÃ¤nge, Arrays absichern, etc.)
    const safeResult = sanitizeBrainOutput(result);

    // ------------------------------------------------------------
// PHASE 4.2.3: Guard anwenden â€“ Core-Grenzen erzwingen
// ------------------------------------------------------------
const guard = enforceCoreResponseBoundaries(safeResult.reply);

if (!guard.ok) {
  logger.warn("core_guard_violation", {
    userId: input.userId,
    violations: guard.violations,
  });

  // Harte Grenze: neutrale, sichere Antwort.
  // Keine Actions/Tasks/NewFacts â€“ nichts Autonomes ausfÃ¼hren.
  safeResult.reply =
    "Ich kann dabei nicht helfen, etwas Eskalierendes/Manipulatives zu formulieren. " +
    "Sag mir stattdessen kurz das Ziel (z.B. sachlich klÃ¤ren, rechtlich prÃ¼fen, nÃ¤chsten Schritt planen), " +
    "dann formuliere ich es neutral und sauber.";

  safeResult.actions = [];
  safeResult.tasks = [];
  safeResult.newFacts = [];
} else {
  logger.info("core_guard_ok", { userId: input.userId });
}

    // ðŸ‘‰ WICHTIG:
    // - Nur "actions" werden serverseitig interpretiert (z.B. reset_context / set_context).
    // - "tasks" sind ausschlieÃŸlich Hinweise fÃ¼r die UI / den Nutzer.
    // - Der Server lÃ¶st KEINE Cronjobs, Push-Tasks oder sonstige Aktionen aus Tasks aus.
    //
    // Damit bleibt Anora explizit nicht-autonom: sie schlÃ¤gt nur vor, der Mensch entscheidet und handelt.

    if (safeResult.actions.length > 0) {
  await executeBrainActions(input.userId, safeResult.actions);
}

if (safeResult.newFacts.length > 0) {
  // Legacy-BrainFacts werden NICHT mehr persistiert.
  // newFacts dienen nur noch als transienter Kontext.
  await updatePropertyContextFromNewFacts(input.userId, safeResult.newFacts);
  await updateMietrechtContextFromFacts(input.userId, safeResult.newFacts);
}

try {
  // Minimal: persistiere ALLE Chat-Facts 1:1 als "chat.memory" in facts_v1
  // (spÃ¤ter kÃ¶nnen wir property/tenant sauber mappen)
  const toUpsert = safeResult.newFacts.map((f, idx) => ({
    domain: "chat",
    key: "memory",
    entityId: `user:${input.userId}`, // simpel, stabil
    value: {
      type: f.type,
      tags: Array.isArray(f.tags) ? f.tags : [],
      data: f.data ?? {},
      raw: f.raw ?? "",
      seq: idx,
    },
    meta: {
      source: "chat",
      ts: Date.now(),
    },
  }));

  const r = await upsertManyFacts(input.userId, toUpsert as any);

  logger.info("chat_memory_upserted_v1", {
    userId: input.userId,
    count: toUpsert.length,
    result: r,
  });
} catch (err) {
  logger.error("chat_memory_upsert_failed_v1", {
    userId: input.userId,
    error: String(err),
  });
}

    // Presence-Logik v1: Kandidaten aus Chat + Tasks prÃ¼fen
    // - passiv, keine Autohandlungen
    // - strikt rate-limitiert
    try {
      await generatePresenceFromChatIfAllowed(input.userId, input, safeResult);
    } catch (err) {
      logger.error("presence_generation_failed", {
        userId: input.userId,
        error: String(err),
      });
    }

    const response: BrainOutput = safeResult;

    res.status(200).json(response);

  } catch (err) {
    logger.error("Fehler in anoraChat:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ------------------------------------------------------------
// Presence: letzte sichtbare Presence-Karte laden
// (statt nur status == "pending")
// ------------------------------------------------------------
async function getLatestVisiblePresenceEvent(
  userId: string
): Promise<{ id: string; data: PresenceEventDoc } | null> {
  const col = db
    .collection("brain")
    .doc(userId)
    .collection("presenceEvents");

  const now = Date.now();

  // NEU: Themen-Block-Meta laden
  const topicMeta = await getPresenceTopicMeta(userId);

  // Wir holen die letzten ~50 Events nach Zeit, filtern dann im Code
  const snap = await col
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  if (snap.empty) return null;

  for (const doc of snap.docs) {
    const data = doc.data() as PresenceEventDoc;

    // 0) Themen-Block prÃ¼fen (Topic global geblockt?)
    if (data.topic) {
      const t = data.topic as PresenceTopic;
      const state = topicMeta[t];
      if (
        state &&
        typeof state.blockedUntil === "number" &&
        state.blockedUntil > now
      ) {
        // dieses Thema ist gerade global geblockt -> nicht anzeigen
        continue;
      }
    }

    // 1) Themen, die explizit abgeschaltet wurden, NIE mehr anzeigen
    if (data.status === "dismissed") {
      continue;
    }

    // 2) Snoozed-Events nur anzeigen, wenn ihre Snooze-Zeit abgelaufen ist
    if (
      data.status === "snoozed" &&
      typeof data.snoozedUntil === "number" &&
      data.snoozedUntil > now
    ) {
      continue;
    }

    // 3) Alles andere (pending, shown, alte snoozed) ist sichtbar
    return { id: doc.id, data };
  }

  // nichts Sichtbares gefunden
  return null;
}

// ------------------------------------------------------------
// HTTPS Endpoint: Anora Presence â€“ nÃ¤chste Presence-Karte laden
// ------------------------------------------------------------
