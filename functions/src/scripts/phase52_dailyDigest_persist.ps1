# =========================
# PHASE 5.2 – DailyDigest Persist + Idempotenz (Emulator)
# =========================

$repoRoot = (Resolve-Path "..").Path
$rc = Get-Content (Join-Path $repoRoot ".firebaserc") -Raw | ConvertFrom-Json
$projectId = $rc.projects.default
if (-not $projectId) { throw "projects.default fehlt in .firebaserc" }

$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:GCLOUD_PROJECT = $projectId
$env:FIREBASE_PROJECT_ID = $projectId

npm run build
if ($LASTEXITCODE -ne 0) { throw "BUILD FAILED" }

function AssertEq($name, $got, $want) {
  if ($null -eq $got) { throw "ASSERT FAILED: $name got=<null> expected=$want" }
  if ($got -ne $want) { throw "ASSERT FAILED: $name expected=$want got=$got" }
}

function Run-One($tier, $msg) {
  $out = @"
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
      satelliteIds: ["document-understanding.v1"],
      tier: "$tier"
    }
  });
  const ran = out?.debug?.satellites?.ran;
  console.log("JSON_RESULT:" + JSON.stringify({
    tier: "$tier",
    ranCount: Array.isArray(ran) ? ran.length : 0,
    persistence: out?.persistence ?? null
  }));
})().catch(e => {
  console.log("JSON_RESULT:" + JSON.stringify({ error: String(e) }));
  process.exit(1);
});
"@ | node | Out-String

  $line = ($out -split "`r?`n") | Where-Object { $_ -like "JSON_RESULT:*" } | Select-Object -Last 1
  if (-not $line) { throw "Kein JSON_RESULT im Node-Output" }
  return ($line.Substring(12) | ConvertFrom-Json)
}

$guid = [guid]::NewGuid().ToString("N")
$base = "digest_persist_$guid"

$pro1  = Run-One "pro"  "$base`__pro"
$pro2  = Run-One "pro"  "$base`__pro"
$free1 = Run-One "free" "$base`__free"
$free2 = Run-One "free" "$base`__free"

AssertEq "pro#1.ran"  $pro1.ranCount  1
AssertEq "pro#2.ran"  $pro2.ranCount  1
AssertEq "free#1.ran" $free1.ranCount 1
AssertEq "free#2.ran" $free2.ranCount 1

AssertEq "pro#1.merge"  $pro1.persistence.counts.dailyDigestMerged 1
AssertEq "pro#2.merge"  $pro2.persistence.counts.dailyDigestMerged 0
AssertEq "free#1.merge" $free1.persistence.counts.dailyDigestMerged 1
AssertEq "free#2.merge" $free2.persistence.counts.dailyDigestMerged 0

Write-Host "OK ✅ Phase 5.2 – Persist + Idempotenz"