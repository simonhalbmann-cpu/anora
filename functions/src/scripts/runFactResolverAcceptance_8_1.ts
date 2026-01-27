// functions/src/scripts/runFactResolverAcceptance_8_1.ts
//
// PHASE 8.1 — Akzeptanztest: 3 Quellen, gleicher entityId::key
// Erwartung:
// - contract gewinnt automatisch
// - kein user override
// - conflict = true (weil unterschiedliche Werte existieren)
//
// AUSFÜHRUNG:
// node .\lib\scripts\runFactResolverAcceptance_8_1.js
//

import assert from "assert";
import * as admin from "firebase-admin";
import { resolveCandidates } from "../core/facts/resolveCandidates";
import type { FactDoc } from "../core/facts/types";

// --- Emulator Guard ----------------------------------------------------------

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST not set (run in emulator)");
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

const db = admin.firestore();

// --- Test Setup --------------------------------------------------------------

const USER_ID = "test_user_phase_8_1";
const ENTITY_ID = "entity_phase_8_1";
const KEY = "rent:cold";
const NOW = Date.now();

function fact(
  factId: string,
  sourceType: "email" | "expose" | "contract",
  value: any,
  scoreHint: number
): FactDoc {
  return {
    factId,
    entityId: ENTITY_ID,
    key: KEY,
    domain: "real_estate",
    value,

    // FactSource: bleibt technisch "raw_event"
    source: "raw_event",
    sourceRef: `${sourceType}_doc`,

    createdAt: NOW,
    updatedAt: NOW,

    // nur EIN meta-Block!
    meta: {
      sourceType,          // "contract" | "email" | "expose"
      system: true,
      latest: true,
      confidence: scoreHint,
      extractorId: `${sourceType}.v1`,
    },
  };
}

// --- Test --------------------------------------------------------------------

async function run() {
  console.log("PHASE 8.1 — Acceptance Test (3 sources)");

  const candidates: FactDoc[] = [
    fact("f_email", "email", { coldRent: 900 }, 0.6),
    fact("f_expose", "expose", { coldRent: 950 }, 0.7),
    fact("f_contract", "contract", { coldRent: 1000 }, 0.95),
  ];

  const result = resolveCandidates(ENTITY_ID, KEY, candidates);

  console.log("RESULT:", JSON.stringify(result, null, 2));

  // --- Assertions -----------------------------------------------------------

  assert.ok(
    result.status === "resolved_with_conflict",
    "expected resolved_with_conflict"
  );

  assert.ok(result.conflict === true, "expected conflict=true");

  assert.ok(
    result.winner.factId === "f_contract",
    "expected contract to win"
  );

  console.log("✅ PASS: contract wins, conflict detected");
}

run()
  .then(() => {
    console.log("PHASE 8.1 DONE");
    process.exit(0);
  })
  .catch((e) => {
    console.error("❌ FAIL:", e);
    process.exit(1);
  });