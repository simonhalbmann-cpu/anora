# =========================
# PHASE 5.2 – Readback Assert (MODEL B)
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

$today = (Get-Date).ToString("yyyy-MM-dd")
$key = "dailyDigest_v1__$today"

@"
const admin = require("firebase-admin");

function assertIntNonNeg(name, v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || Math.floor(v) !== v) {
    throw new Error(name + " invalid: " + JSON.stringify(v));
  }
}

(async () => {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const ref = db.collection("brain")
    .doc("debug-user")
    .collection("meta")
    .doc("$key");

  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT FOUND");

  const doc = snap.data();
  const cc = doc.contributionsCount;
  const { processedLocal, blockedByTier, errors } = doc.counts;

  assertIntNonNeg("contributionsCount", cc);
  assertIntNonNeg("processedLocal", processedLocal);
  assertIntNonNeg("blockedByTier", blockedByTier);
  assertIntNonNeg("errors", errors);

  if (cc !== processedLocal + errors)
    throw new Error("MODEL B FAIL: cc mismatch");

  if (blockedByTier > processedLocal)
    throw new Error("MODEL B FAIL: blockedByTier > processedLocal");

  console.log("OK ✅ MODEL B invariant holds");
})();
"@ | node