// functions/src/scripts/runFactResolverAcceptance_8_2_user_override.ts
//
// PHASE 8.2 — User Override schlägt alles
//
// Erwartung:
// - user_override gewinnt immer
// - kein tie
// - kein needs_user
// - conflict kann true sein (andere Werte existieren)
//
// AUSFÜHRUNG:
// node .\lib\scripts\runFactResolverAcceptance_8_2_user_override.js
//

import assert from "assert";
import { resolveCandidates } from "../core/facts/resolveCandidates";
import type { FactDoc } from "../core/facts/types";

// --- Test Setup --------------------------------------------------------------

const ENTITY_ID = "entity_phase_8_2";
const KEY = "rent:cold";
const NOW = Date.now();

function fact(
  factId: string,
  sourceType: "email" | "expose" | "contract" | "user",
  value: any,
  confidence: number,
  override = false
): FactDoc {
  return {
    factId,
    entityId: ENTITY_ID,
    key: KEY,
    domain: "real_estate",
    value,

    // ✅ source bleibt IMMER ein gültiger FactSource
    source: "raw_event",

    sourceRef: `${sourceType}_doc`,
    createdAt: NOW,
    updatedAt: NOW,

    meta: {
      sourceType,          // "user" ist hier erlaubt
      system: true,
      latest: true,
      confidence,

      // ✅ Override-Semantik liegt NUR in meta
      override,
      finality: override ? "final" : "draft",

      extractorId: `${sourceType}.v1`,
    },
  };
}

// --- Test --------------------------------------------------------------------

async function run() {
  console.log("PHASE 8.2 — User Override Test");

  const candidates: FactDoc[] = [
    fact("f_email", "email", { coldRent: 900 }, 0.7),
    fact("f_contract", "contract", { coldRent: 1000 }, 0.95),
    fact(
      "f_user",
      "user",
      { coldRent: 850 },
      0.4,
      true // 👈 override
    ),
  ];

  const result = resolveCandidates(ENTITY_ID, KEY, candidates);

  console.log("RESULT:", JSON.stringify(result, null, 2));

  // --- Assertions ------------------------------------------------------------

  assert.ok(
    result.status === "resolved" || result.status === "resolved_with_conflict",
    "expected resolved"
  );

  assert.ok(result.winner.factId === "f_user", "expected user override to win");

  console.log("✅ PASS: user override wins over contract");
}

run()
  .then(() => {
    console.log("PHASE 8.2 USER OVERRIDE DONE");
    process.exit(0);
  })
  .catch((e) => {
    console.error("❌ FAIL:", e);
    process.exit(1);
  });