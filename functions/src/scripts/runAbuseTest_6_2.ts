// functions/src/scripts/runAbuseTest_6_2.ts
import { strict as assert } from "assert";
import admin from "firebase-admin";
import "../core/facts/registryBootstrap";
import { runCoreWithPersistence } from "../core/runCoreWithPersistence";

function assertExecuted(p: any): asserts p is { dryRun: false; wrote: true; reason: "executed"; counts: { rawEventsAppended: number; factsUpserted: number; haltungPatched: number } } {
  assert.equal(p?.dryRun, false);
  assert.equal(p?.wrote, true);
  assert.equal(p?.reason, "executed");
  assert.ok(p?.counts);
}

function stableHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-anora" });
  }
  const db = admin.firestore();

  const userId = "u_abuse_6_2";
  const baseText =
    "Ich bin Vermieter in Berlin. Adresse: Musterstraße 1. 80 qm, 3 Zimmer.";

  // --- Case 0: dryRun must not write (idempotent) ---
{
  // Use a unique text per run so rawEventId is guaranteed fresh
  const uniqueText = baseText + ` Kaltmiete 1200 Euro. [dryrun:${Date.now()}]`;

  const out = await runCoreWithPersistence({
    userId,
    text: uniqueText,
    dryRun: true,
  });

  assert.equal(out.persistence.dryRun, true);
  assert.equal(out.persistence.wrote, false);
  assert.equal(out.persistence.reason, "dry_run");

  const rawEventId = out.rawEvent.rawEventId;

  const snap = await db
    .collection("core")
    .doc(userId)
    .collection("rawEvents")
    .doc(rawEventId)
    .get();

  // This must be false because this rawEventId has never been written
  assert.equal(snap.exists, false, "dryRun=true must not create rawEvent doc for unique input");
}

  // --- Case 1: contradiction ---
  const texts = [
    baseText + " Kaltmiete 1200 Euro.",
    baseText + " Kaltmiete 900 Euro.",
    baseText + " Kaltmiete 1200 Euro.",
  ];

  for (let i = 0; i < texts.length; i++) {
    const out = await runCoreWithPersistence({
      userId,
      text: texts[i],
      dryRun: false,
    });

    assert.equal(out.persistence.reason, "executed");
    assert.equal(out.persistence.counts.rawEventsAppended, 1);
    assert.equal(out.persistence.counts.factsUpserted, out.writePlan.facts.count);
    assertExecuted(out.persistence);

// In contradiction texts we do NOT expect Haltung learning
assert.equal(out.writePlan.haltung.mode, "none");
assert.equal(out.persistence.counts.haltungPatched, 0);
    

    console.log("✅ CONTRADICTION OK", {
      step: i,
      hash: stableHash(texts[i]),
      counts: out.persistence.counts,
    });
  }

  // --- Case 2: flood ---
  for (let i = 0; i < 40; i++) {
    const out = await runCoreWithPersistence({
      userId,
      text: i % 2 === 0 ? "danke" : "ok, machen wir so",
      extractorIds: [],
      dryRun: false,
    });

    assertExecuted(out.persistence);
assert.equal(out.writePlan.haltung.mode, "patch");
assert.ok(out.writePlan.haltung.keys.length > 0);
assert.equal(out.persistence.counts.haltungPatched, 1);
  }

  console.log("✅ ABUSE TEST 6.2 PASSED");
}

main().catch((e) => {
  console.error("❌ ABUSE TEST 6.2 FAILED", e);
  process.exit(1);
});
