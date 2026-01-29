// functions/src/scripts/runDigestRead_5_3.ts
import { strict as assert } from "assert";
import admin from "firebase-admin";

import { runCoreWithPersistence } from "../core/bridgePure";
import { dayBucketUTC } from "../core/rawEvents/hash";

async function runOne(params: { userId: string; tier: "free" | "pro"; text: string }) {
  const out = await runCoreWithPersistence({
    userId: params.userId,
    text: params.text,
    dryRun: false,
    extractorIds: [], // IMPORTANT: keep facts off
    state: {
      locale: "de-DE",
      facts: [],
      haltung: undefined,
      tier: params.tier,
    },
  });

  assert.equal(out.persistence.dryRun, false);
  assert.equal(out.writePlan.rawEvent, "append");
  // facts must be none because extractorIds=[]
  assert.equal(out.writePlan.facts.mode, "none");

  // dailyDigest should be planned when satellite ran
  assert.equal(out.writePlan.dailyDigest.mode, "merge");
  assert.ok(out.writePlan.dailyDigest.count >= 1);

  return out;
}

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

  if (!admin.apps.length) {
  // Wichtig: muss zum Emulator-Projekt passen (bei dir: anoraapp-ai)
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    "anoraapp-ai";

  admin.initializeApp({ projectId });
}

  const db = admin.firestore();

  const dayBucket = dayBucketUTC(Date.now());
  const key = `dailyDigest_v1__${dayBucket}`;

  // ---- FREE (should produce blockedByTier > 0)
  const userFree = "u_digest_free";
  const textFree =
    "Dies ist ein ausreichend langer Text damit hasText true ist. ".repeat(3);

  await runOne({ userId: userFree, tier: "free", text: textFree });

  const refFree = db.collection("brain").doc(userFree).collection("meta").doc(key);
  const snapFree = await refFree.get();
  assert.equal(snapFree.exists, true, "dailyDigest meta doc must exist for FREE");
  const docFree: any = snapFree.data();

  const blockedFree = docFree?.counts?.blockedByTier ?? 0;
  assert.ok(blockedFree > 0, "FREE must have blockedByTier > 0");

  // ---- PRO (should produce blockedByTier == 0)
  const userPro = "u_digest_pro";
  const textPro =
    "Dies ist ein ausreichend langer Text damit hasText true ist. ".repeat(3);

  await runOne({ userId: userPro, tier: "pro", text: textPro });

  const refPro = db.collection("brain").doc(userPro).collection("meta").doc(key);
  const snapPro = await refPro.get();
  assert.equal(snapPro.exists, true, "dailyDigest meta doc must exist for PRO");
  const docPro: any = snapPro.data();

  const blockedPro = docPro?.counts?.blockedByTier ?? 0;
  assert.equal(blockedPro, 0, "PRO must have blockedByTier == 0");

  console.log("✅ DIGEST READ 5.3 PASSED", {
    key,
    free: { blockedByTier: blockedFree, counts: docFree?.counts },
    pro: { blockedByTier: blockedPro, counts: docPro?.counts },
  });
}

main().catch((e) => {
  console.error("⛔ DIGEST READ 5.3 FAILED", e);
  process.exit(1);
});