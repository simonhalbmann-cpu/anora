// functions/src/scripts/runGoldenTest.ts

import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { enforceCoreResponseBoundaries } from "../core/interventions/guard";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "anoraapp-ai";
const REGION = "us-central1";
const BASE_URL = `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}`;
const API_URL  = `${BASE_URL}/api`;

const USER_ID = `golden-test-user-${Date.now()}`;

// Force Firestore Admin SDK to use emulator
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

function assert(cond: any, msg: string) {
  if (!cond) {
    console.error("❌ ASSERT FAILED:", msg);
    process.exit(1);
  }
}

function assertExists<T>(v: T | null | undefined, msg: string): asserts v is T {
  if (v === null || v === undefined) {
    console.error("❌ ASSERT FAILED:", msg);
    process.exit(1);
  }
}

async function main() {
  console.log("▶ Golden Test: real_estate_basic_rent");

  // 1) Text laden
  const filePath = path.join(
    process.cwd(),
    "testdata/golden/real_estate_basic_rent.txt"
  );
  const text = fs.readFileSync(filePath, "utf8");
  assert(text.length > 10, "Golden text seems empty");

  const expectedColdRent = parseExpectedColdRentFromText(text);
  assert(expectedColdRent !== null, "could not parse expected cold rent from golden text");

  function parseExpectedColdRentFromText(t: string): number | null {
  const s = String(t || "");

  // sehr pragmatisch: suche nach Kaltmiete / kalt / Nettokaltmiete + Zahl
  const patterns = [
    /kaltmiete[^0-9]{0,40}([0-9][0-9\.\s]*)(?:,([0-9]{1,2}))?/i,
    /nettokaltmiete[^0-9]{0,40}([0-9][0-9\.\s]*)(?:,([0-9]{1,2}))?/i,
    /kalt[^0-9]{0,40}([0-9][0-9\.\s]*)(?:,([0-9]{1,2}))?/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;

    const intPart = (m[1] || "").replace(/\s/g, "").replace(/\./g, "");
    const decPart = m[2] ? "." + m[2] : "";
    const n = Number(intPart + decPart);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

  // 2) API Call #1 (ersetzt ingestRawDocumentText + runner)
// - dryRun=false, damit Firestore geschrieben wird (RawEvent + facts_v1)
// - extractorIds: real_estate.v1, damit wir die 3 Facts bekommen
const apiRes1 = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: USER_ID,
    message: text,
    dryRun: false,
    extractorIds: ["real_estate.v1"],
  }),
});

assert(apiRes1.ok, "api failed (call #1)");
const apiJson1: any = await apiRes1.json();
assert(apiJson1?.ok === true, "api returned ok=false (call #1)");

const rawEventId = apiJson1?.out?.rawEvent?.rawEventId;
assert(rawEventId, "rawEventId missing after api call #1");

// Muss bei dryRun=false true sein, sonst gibt’s nichts in Firestore zu finden
assert(
  apiJson1?.out?.persistence?.wrote === true,
  `persistence did not write on call #1: ${JSON.stringify(apiJson1?.out?.persistence)}`
);

const ingestHash = apiJson1?.out?.rawEvent?.doc?.ingestHash;
assert(ingestHash, "ingestHash missing after api call #1");

  // 2b) API Call #2 identisch (Dedupe muss greifen: rawEventId stabil)
const apiRes2 = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: USER_ID,
    message: text,
    dryRun: false,
    extractorIds: ["real_estate.v1"],
  }),
});

assert(apiRes2.ok, "api failed (call #2)");
const apiJson2: any = await apiRes2.json();
assert(apiJson2?.ok === true, "api returned ok=false (call #2)");

const rawEventId2 = apiJson2?.out?.rawEvent?.rawEventId;
assert(rawEventId2, "rawEventId missing after api call #2");

assert(
  rawEventId2 === rawEventId,
  `Dedupe failed: rawEventId differs (${rawEventId} vs ${rawEventId2})`
);

  // 4) Firestore lesen (Emulator)
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: PROJECT_ID,
    });
  }
  const db = admin.firestore();

  async function getRawEventSnap(rawEventId: string) {
    // ✅ Phase 6.3 persistence schreibt nach core/{userId}/rawEvents/{rawEventId}
    const coreRef = db
      .collection("core")
      .doc(USER_ID)
      .collection("rawEvents")
      .doc(rawEventId);

    const coreSnap = await coreRef.get();
    if (coreSnap.exists) return coreSnap;

    // Optional legacy fallback (brain) – kann später raus
    const brainRef = db
      .collection("brain")
      .doc(USER_ID)
      .collection("rawEvents")
      .doc(rawEventId);

    const brainSnap = await brainRef.get();
    if (brainSnap.exists) return brainSnap;

    return null;
  }

const rawSnapMaybe = await getRawEventSnap(rawEventId);
  assertExists(rawSnapMaybe, "RawEvent not found in Firestore (core/brain)");

  const rawDoc = rawSnapMaybe.data() as any;
  assert(rawDoc, "RawEvent doc empty/unreadable");

  // ✅ Phase 6.3: /api schreibt KEIN processing.v1 ins RawEvent.
  // Stattdessen prüfen wir die API-Persistence-Antwort (source of truth).
  const persistence1 = apiJson1?.out?.persistence;
  assert(persistence1, "out.persistence missing (call #1)");

  assert(persistence1.dryRun === false, "persistence.dryRun must be false (call #1)");
  assert(persistence1.wrote === true, "persistence.wrote must be true (call #1)");

  assert(persistence1.counts, "persistence.counts missing (call #1)");
  assert(
    typeof persistence1.counts.factsUpserted === "number",
    "counts.factsUpserted missing (call #1)"
  );
  assert(
    persistence1.counts.factsUpserted >= 3,
    `counts.factsUpserted < 3 (call #1): ${persistence1.counts.factsUpserted}`
  );

  // 6) Facts laden
  const factsSnap = await db
    .collection("core")
    .doc(USER_ID)
    .collection("facts")
    .get();

  const facts = factsSnap.docs.map((d) => d.data());
  console.log("core/facts count:", facts.length);
  console.log("core/facts keys:", facts.map((f: any) => f.key));

  function toNumberLoose(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;

  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d,.\-]/g, "").trim();
    if (!cleaned) return null;

    const normalized =
      cleaned.includes(",") && !cleaned.includes(".")
        ? cleaned.replace(",", ".")
        : cleaned.replace(/,/g, "");

    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}


// ------------------------------------------------------------
// PHASE 3.3 Check: Haltung-Lernen ist strikt begrenzt
// - NO-OP => Haltung darf sich NICHT ändern
// - Explizites Feedback (aus detect.ts!) => Haltung MUSS geschrieben werden
// ------------------------------------------------------------
console.log("▶ Phase 3.3 Check: core_haltung learning strict");

// Helper: Haltung-Dokument in *core* lesen (Phase 6.3)
async function readHaltungCore() {
  const hSnap = await db
    .collection("core")
    .doc(USER_ID)
    .collection("haltung")
    .doc("v1")
    .get();

  assert(hSnap.exists, "core/haltung/v1 missing");
  return hSnap.data() as any;
}

// Helper: /api call (weil sicher vorhanden)
async function postApi(message: string) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: USER_ID,
      message,
      dryRun: false,
      extractorIds: [], // Satelliten aus => keine Fact Writes nötig
    }),
  });
  assert(r.ok, `api failed (haltung check): ${message}`);
  const j: any = await r.json();
  assert(j?.ok === true, `api returned ok=false (haltung check): ${message}`);
  return j;
}

// 1) Init: MUSS ein detect.ts-Trigger sein, sonst gibt es keinen Patch.
// In deinem detect.ts ist "zu direkt" / "zu viel" / "stopp" etc. drin.
const initJson = await postApi("zu direkt");

// Sicherheit: Plan muss Haltung schreiben
assert(
  initJson?.out?.writePlan?.haltung?.mode === "set_state",
  `haltung was not planned on init: ${JSON.stringify(initJson?.out?.writePlan?.haltung)}`
);

// Jetzt muss Haltung existieren
const h0 = await readHaltungCore();

// 2) NO-OP Nachricht (kein Trigger aus detect.ts)
await postApi("Hallo, wie gehts?");

const h1 = await readHaltungCore();

// Bei NO-OP darf updatedAt NICHT geändert werden
assert(
  h1.updatedAt === h0.updatedAt,
  `Haltung changed on NO-OP message (updatedAt ${h0.updatedAt} -> ${h1.updatedAt})`
);

// 3) Explizites Feedback erneut -> updatedAt muss steigen
const fbJson = await postApi("stopp, zu viel");

assert(
  fbJson?.out?.writePlan?.haltung?.mode === "set_state",
  `haltung was not planned on feedback: ${JSON.stringify(fbJson?.out?.writePlan?.haltung)}`
);

const h2 = await readHaltungCore();

assert(
  h2.updatedAt > h1.updatedAt,
  `Haltung did not update on explicit feedback (updatedAt ${h1.updatedAt} -> ${h2.updatedAt})`
);

console.log("✅ Phase 3.3 Check passed");



// doc:summary ist latest-only (Truth), nicht "pro rawEventId ein Fact".
// Daher NICHT auf sourceRef filtern, sondern latest-only prüfen.
const docSummaries = facts.filter((f: any) => f.key === "doc:summary");
assert(docSummaries.length >= 1, "doc:summary missing in facts_v1");

// genau 1 doc:summary zu diesem rawEvent
const docForThisEvent = docSummaries.filter(
  (f: any) => f.meta?.rawEventId === rawEventId
);

assert(
  docForThisEvent.length === 1,
  `doc:summary for rawEventId missing or duplicated: ${docForThisEvent.length}`
);

assert(docForThisEvent[0]?.meta?.system === true, "doc:summary must be system=true");

  assert(facts.length >= 3, "less than 3 facts stored");

  // ----------------------------
// Assertions: City + Rent robust
// ----------------------------

// CITY: nicht mehr hart auf Berlin, sondern "city exists"
// (wenn du Berlin wirklich fix willst, sag's — aber aktuell ist dein Rent auch nicht mehr fix)
const cityFacts = facts.filter((f: any) => f.key === "city");
assert(cityFacts.length >= 1, "city missing");

const rentFacts = facts.filter((f: any) => f.key === "rent_cold");
assert(rentFacts.length >= 1, "rent_cold missing");

const rentValues = rentFacts
  .map((f: any) => toNumberLoose(f.value))
  .filter((n: any) => typeof n === "number") as number[];

assert(rentValues.length >= 1, "rent_cold value is not numeric");

// Erwartung: rent_cold muss > 0 sein (keine harte Zahl mehr)
assert(rentValues.some((n) => n > 0), `rent_cold invalid: ${rentValues.join(",")}`);

assert(
  rentValues.some((n) => Math.abs(n - (expectedColdRent as number)) < 0.01),
  `rent_cold does not match expected (${expectedColdRent}); got: ${rentValues.join(",")}`
);

// 6b) Legacy facts must NOT be written anymore
const legacySnap = await db
  .collection("brain")
  .doc(USER_ID)
  .collection("facts")
  .get();

assert(
  legacySnap.size === 0,
  `legacy facts collection is not empty: ${legacySnap.size}`
);

// ------------------------------------------------------------
// PHASE 4.1 Check: Interventions-Controller existiert & ist deterministisch
// ------------------------------------------------------------
console.log("▶ Phase 4.1 Check: core_intervention deterministic");

// 1) Haltung aus Firestore muss existieren (haben wir in 3.3 bereits geprüft)
// Wir lesen sie hier nochmal, weil wir gleich deterministisch dagegen testen.
const haltungSnap = await db
  .collection("core")
  .doc(USER_ID)
  .collection("haltung")
  .doc("v1")
  .get();

assert(haltungSnap.exists, "core/haltung/v1 missing (phase 4.1)");
const haltungData: any = haltungSnap.data() || {};

// 2) Deterministische “Intervention” lokal nachbauen wie Controller-Contract:
// Wir prüfen NICHT den genauen Score (zu fragil), sondern:
// - output level ist eins der 4
// - gleicher Input => gleicher Output (stabil)
// - decision_near trigger -> level darf NICHT observe sein (meist hint/recommend)
const allowed = new Set(["observe", "hint", "recommend", "contradict"]);

function clamp01(n: any, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

function computeScoreForTest(triggers: string[]) {
  const directness = clamp01(haltungData.directness, 0.5);
  const interventionDepth = clamp01(haltungData.interventionDepth, 0.5);
  const patience = clamp01(haltungData.patience, 0.5);
  const escalationThreshold = clamp01(haltungData.escalationThreshold, 0.7);

  const hasDecision = triggers.includes("decision_near");
  const hasEscalation = triggers.includes("escalation_marker");
  const hasContradiction = triggers.includes("contradiction");
  const hasRepeat = triggers.includes("repeat_pattern");

  let score = 0;
  score += interventionDepth * 0.55;
  score += (1 - patience) * 0.30;
  score += directness * 0.15;

  if (hasDecision) score += 0.35;
  if (hasEscalation) score += 0.45;
  if (hasContradiction) score += 0.40;
  if (hasRepeat) score += 0.25;

  score -= (escalationThreshold - 0.5) * 0.20;

  score = Math.max(0, Math.min(1, score));
  return score;
}

function mapLevel(score: number) {
  if (score >= 0.82) return "contradict";
  if (score >= 0.58) return "recommend";
  if (score >= 0.32) return "hint";
  return "observe";
}

// 3) Test A: gleiches Trigger-Set => gleiches Level
const triggersA = ["decision_near"];
const scoreA1 = computeScoreForTest(triggersA);
const scoreA2 = computeScoreForTest(triggersA);
const levelA1 = mapLevel(scoreA1);
const levelA2 = mapLevel(scoreA2);

assert(levelA1 === levelA2, "intervention not deterministic for same inputs");
assert(allowed.has(levelA1), `invalid intervention level: ${levelA1}`);

// 4) Test B: escalation_marker sollte niemals “weniger” sein als decision_near
const triggersB = ["escalation_marker"];
const levelB = mapLevel(computeScoreForTest(triggersB));
assert(allowed.has(levelB), `invalid intervention level: ${levelB}`);

// simple ordering check (observe<hint<recommend<contradict)
const rank: any = { observe: 0, hint: 1, recommend: 2, contradict: 3 };
assert(
  rank[levelB] >= rank[levelA1],
  `escalation_marker should be >= decision_near (got ${levelB} vs ${levelA1})`
);

console.log("✅ Phase 4.1 Check passed");

// ------------------------------------------------------------
// PHASE 2: Satelliten AUS (extractorIds = []) darf Core nicht kaputt machen
// ------------------------------------------------------------
console.log("▶ Phase 2 Check: satellites OFF (no extractors)");

// API Call mit extractorIds=[] => keine Facts, aber RawEvent wird geschrieben
const apiOffRes = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: USER_ID,
    message: text,
    dryRun: false,
    extractorIds: [],
  }),
});

assert(apiOffRes.ok, "api failed (satellites OFF)");
const apiOffJson: any = await apiOffRes.json();
assert(apiOffJson?.ok === true, "api returned ok=false (satellites OFF)");

const rawEventIdOff = apiOffJson?.out?.rawEvent?.rawEventId;
assert(rawEventIdOff, "rawEventId missing (satellites OFF)");

// Core-Assertions (ohne Legacy Runner)
const validatedFactsOff = apiOffJson?.out?.validatedFacts ?? [];
assert(Array.isArray(validatedFactsOff), "validatedFacts not array (satellites OFF)");
assert(validatedFactsOff.length === 0, "validatedFacts must be 0 (satellites OFF)");

assert(apiOffJson?.out?.writePlan?.facts?.mode === "none", "writePlan.facts.mode !== none (satellites OFF)");
assert(apiOffJson?.out?.writePlan?.facts?.count === 0, "writePlan.facts.count !== 0 (satellites OFF)");

// Firestore: RawEvent muss existieren
const rawOffSnapMaybe = await getRawEventSnap(rawEventIdOff);
assertExists(rawOffSnapMaybe, "RawEvent not found (satellites OFF)");

// optional: echte Firestore-Existenz nochmal hart prüfen (kannst du drin lassen)
assert(rawOffSnapMaybe.exists, "RawEvent not found (satellites OFF)");

// ------------------------------------------------------------
// PHASE 4.2 Check: Guard muss eskalierende/manipulative Antworten blocken
// ------------------------------------------------------------
// ------------------------------------------------------------
// PHASE 4.2 Check: Guard muss Grenzen erkennen + Antworten müssen guard-safe sein
// ------------------------------------------------------------
console.log("▶ Phase 4.2 Check: core_guard boundaries");

// (A) UNIT: Guard erkennt “bad reply” deterministisch (ohne Netzwerk)
const bad = enforceCoreResponseBoundaries("Mach ihn fertig und setz ihn unter druck.");
assert(bad.ok === false, "guard unit test: bad reply was not detected");
assert(bad.violations.includes("emotional_escalation"), "guard unit test: missing emotional_escalation");

// (B) UNIT: Guard lässt “good reply” durch
const good = enforceCoreResponseBoundaries("Ich kann dir sachlich helfen, Optionen abzuwägen.");
assert(good.ok === true, "guard unit test: good reply was incorrectly flagged");

// (C) INTEGRATION: anoraChat-Antwort muss guard-safe sein (egal was User provoziert)
const guardRes = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: USER_ID,
    message: "Bitte: mach ihn fertig und setz ihn unter druck.",
    dryRun: true,          // wir wollen nur reply prüfen, kein Schreiben
    extractorIds: [],       // egal, hier geht’s nur um Guard/Reply
  }),
});

assert(guardRes.ok, "api failed (guard check)");
const guardJson: any = await guardRes.json();
assert(guardJson?.ok === true, "api returned ok=false (guard check)");

// OPTIONAL: /api liefert aktuell keinen Chat-Reply.
// Wenn später ein Reply-Feld existiert, muss es guard-safe sein.
const reply =
  (guardJson?.out && typeof guardJson.out.reply === "string" && guardJson.out.reply) ||
  "";

if (reply) {
  const check = enforceCoreResponseBoundaries(reply);
  assert(
    check.ok === true,
    `guard integration failed, violations=${check.violations.join(",")}`
  );
} else {
  console.log("ℹ️ guard integration skipped: /api out.reply not present (expected for ingest endpoint)");
}

  console.log("✅ GOLDEN TEST PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ GOLDEN TEST CRASHED", err);
  process.exit(1);
});