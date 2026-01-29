# =========================
# PHASE 5.2 – Bounds: mergedRawEventIds capped at 50
# =========================

$repoRoot = (Resolve-Path "..").Path
$rc = Get-Content (Join-Path $repoRoot ".firebaserc") -Raw | ConvertFrom-Json
$projectId = $rc.projects.default
if (-not $projectId) { throw "projects.default fehlt" }

$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:GCLOUD_PROJECT = $projectId
$env:FIREBASE_PROJECT_ID = $projectId

npm run build
if ($LASTEXITCODE -ne 0) { throw "BUILD FAILED" }

function Run-One($msg) {
@"
const { runCoreWithPersistence } = require("./lib/core/runCoreWithPersistence");
(async () => {
  const out = await runCoreWithPersistence({
    userId: "debug-user",
    text: "$msg",
    dryRun: false,
    extractorIds: [],
    state: {
      locale: "de-DE",
      facts: [],
      haltung: undefined,
      tier: "pro"
    }
  });
  console.log("OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
"@ | node | Out-Null
}

$guid = [guid]::NewGuid().ToString("N")
for ($i=1; $i -le 55; $i++) {
  Write-Host "RUN $i/55"
  Run-One "digest_bounds_$guid`__$i"
}

@"
const admin = require("firebase-admin");
(async () => {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const ref = db.collection("brain")
    .doc("debug-user")
    .collection("meta")
    .doc("dailyDigest_v1__1970-01-01");

  const snap = await ref.get();
  const ids = snap.data()?.mergedRawEventIds ?? [];
  console.log("mergedRawEventIdsLen:", ids.length);
  if (ids.length > 50) throw new Error("BOUND FAIL");
  console.log("OK ✅ bounds <= 50");
})();
"@ | node