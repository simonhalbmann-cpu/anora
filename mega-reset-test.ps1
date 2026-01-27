# =========================
# ANORA MEGA RESET TEST v3
# - uses DEV SECRET
# - seeds facts + meta docs
# - asserts before/after
# - tests resetUserKnowledge and resetUserPersonality
# - NO exit (keeps console alive)
# =========================

$ErrorActionPreference = "Stop"

# ==== CONFIG ====
$base      = "http://127.0.0.1:5001/anoraapp-ai/us-central1/api"
$userId    = "NeYaphz5rlV3kvX6EeeqAO1Zuol2"
$devSecret = "1ce4a97531c1201bdc76537c44b9b10e16493864ceabcbd4abebaf0dec539d5e"
$devHdr    = @{ "x-dev-secret" = $devSecret.Trim() }

function Title($t) {
  Write-Host ""
  Write-Host "==============================" -ForegroundColor DarkGray
  Write-Host $t -ForegroundColor Cyan
  Write-Host "==============================" -ForegroundColor DarkGray
}

function Assert($cond, $msg) {
  if (-not $cond) {
    throw "ASSERT FAILED: $msg"
  }
  Write-Host "✅ $msg" -ForegroundColor Green
}

function PostJson($name, $path, $bodyObj) {
  Write-Host ""
  Write-Host "--- $name ---" -ForegroundColor Yellow
  $json = ($bodyObj | ConvertTo-Json -Depth 30)
  $resp = Invoke-RestMethod -Method Post -Uri "$base/$path" -Headers $devHdr -ContentType "application/json" -Body $json
  return $resp
}

function FactsCount() {
  (PostJson "devReadFactsCount" "devReadFactsCount" @{ userId = $userId }).count
}

function MetaList() {
  PostJson "devListMetaDocs" "devListMetaDocs" @{ userId = $userId }
}

function SetMeta($docId, $data) {
  PostJson "devSetMetaDoc $docId" "devSetMetaDoc" @{ userId=$userId; docId=$docId; data=$data } | Out-Null
}

try {
  # ---------- 0) Sanity ----------
  Title "0) Sanity"
  $ping = PostJson "Ping devReadFactsCount" "devReadFactsCount" @{ userId = $userId }
  Assert ($ping.ok -eq $true) "Ping ok"

  # ---------- 1) Clean slate ----------
  Title "1) Clean slate"
  $rk0 = PostJson "resetUserKnowledge (clean)" "resetUserKnowledge" @{ userId = $userId }
  $rp0 = PostJson "resetUserPersonality (clean)" "resetUserPersonality" @{ userId = $userId }

  $c0 = FactsCount
  Write-Host ("Facts after clean: " + $c0) -ForegroundColor Gray
  Assert ($c0 -eq 0) "Facts count is 0 after clean slate"

  # ---------- 2) Seed facts ----------
  Title "2) Seed facts"
  $seed = PostJson "devSeedFacts" "devSeedFacts" @{ userId = $userId }
  $c1 = FactsCount
  Write-Host ("Facts after seed: " + $c1) -ForegroundColor Gray
  Assert ($c1 -ge 2) "Facts count >= 2 after devSeedFacts"

  # ---------- 3) Seed meta docs ----------
  Title "3) Seed meta docs"
  $now = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $day = (Get-Date).ToString("yyyy-MM-dd")
  $docDigest = "dailyDigest_v1__" + $day

  SetMeta $docDigest @{ message="TEST DIGEST"; createdAt=$now; source="test" }
  SetMeta "presence_v1__active" @{ message="TEST PRESENCE"; type="generic"; createdAt=$now; source="test" }
  SetMeta "presence_settings" @{ enabled=$true; updatedAt=$now; source="test" }
  SetMeta "presence_topics" @{ topics=@{ generic=@{ lastDisabledAt=123 } }; updatedAt=$now; source="test" }
  SetMeta "haltung" @{ version=1; directness=0.9; updatedAt=$now; source="test" }
  SetMeta "random_meta_keep" @{ foo="bar"; updatedAt=$now; source="test" }

  $metaBefore = MetaList
  Assert ($metaBefore.count -ge 2) "Meta docs exist before reset"
  Assert ($metaBefore.ids -contains $docDigest) "Meta contains dailyDigest doc"
  Assert ($metaBefore.ids -contains "presence_v1__active") "Meta contains presence_v1__active"
  Assert ($metaBefore.ids -contains "presence_settings") "Meta contains presence_settings"
  Assert ($metaBefore.ids -contains "presence_topics") "Meta contains presence_topics"
  Assert ($metaBefore.ids -contains "haltung") "Meta contains haltung"
  Assert ($metaBefore.ids -contains "random_meta_keep") "Meta contains random_meta_keep"

  # ---------- 4) Reset Knowledge ----------
  Title "4) TEST: resetUserKnowledge"
  $rk = PostJson "resetUserKnowledge" "resetUserKnowledge" @{ userId = $userId }

  $c2 = FactsCount
  Write-Host ("Facts after resetUserKnowledge: " + $c2) -ForegroundColor Gray
  Assert ($c2 -eq 0) "Facts count is 0 after resetUserKnowledge"

  $metaAfterKnowledge = MetaList
  Assert (-not ($metaAfterKnowledge.ids -contains $docDigest)) "dailyDigest deleted by resetUserKnowledge"
  Assert (-not ($metaAfterKnowledge.ids -contains "presence_v1__active")) "presence_v1__active deleted by resetUserKnowledge"
  Assert (-not ($metaAfterKnowledge.ids -contains "presence_settings")) "presence_settings deleted by resetUserKnowledge"
  Assert (-not ($metaAfterKnowledge.ids -contains "presence_topics")) "presence_topics deleted by resetUserKnowledge"

  Assert ($metaAfterKnowledge.ids -contains "haltung") "haltung is NOT deleted by resetUserKnowledge"
  Assert ($metaAfterKnowledge.ids -contains "random_meta_keep") "random_meta_keep is NOT deleted by resetUserKnowledge"

  # ---------- 5) Reset Personality ----------
  Title "5) TEST: resetUserPersonality"
  $rp = PostJson "resetUserPersonality" "resetUserPersonality" @{ userId = $userId }

  $metaAfterPersonality = MetaList
  Assert (-not ($metaAfterPersonality.ids -contains "haltung")) "haltung deleted by resetUserPersonality"
  Assert ($metaAfterPersonality.ids -contains "random_meta_keep") "random_meta_keep is NOT deleted by resetUserPersonality"

  Title "✅ ALL MEGA TESTS PASSED"
  Write-Host "Backend behavior matches intended button semantics." -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "❌ MEGA TEST FAILED" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message -ForegroundColor DarkRed
  }
  Write-Host ""
  Write-Host "Stack:" -ForegroundColor DarkGray
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
}

# keep window open when run from double-click / new process
Write-Host ""
Write-Host "Press ENTER to close..." -ForegroundColor DarkGray
[void][System.Console]::ReadLine()
