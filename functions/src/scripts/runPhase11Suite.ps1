# functions/src/scripts/runPhase11Suite.ps1
# Usage (Windows PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\src\scripts\runPhase11Suite.ps1
#
# Voraussetzung:
# - Emulator läuft (functions + firestore) auf:
#   functions: 127.0.0.1:5001
#   firestore: 127.0.0.1:8080

$ErrorActionPreference = "Stop"

# --- Resolve paths robust (kein Hardcode auf C:\...) ---
$functions = Split-Path -Parent $MyInvocation.MyCommand.Path     # .../functions/src/scripts
$functions = Split-Path -Parent $functions                       # .../functions/src
$functions = Split-Path -Parent $functions                       # .../functions

$projectId = "anoraapp-ai"
$region    = "us-central1"
$base      = "http://127.0.0.1:5001/$projectId/$region"

function Call-Api($payload) {
  return Invoke-RestMethod `
    -Method Post `
    -Uri "$base/api" `
    -ContentType "application/json" `
    -Body ($payload | ConvertTo-Json -Depth 20)
}

Write-Host "=== BUILD + GOLDEN ==="
Set-Location $functions

npm run build
npx ts-node .\src\scripts\runGoldenTest.ts

Write-Host ""
Write-Host "=== CORE FREEZE NEG ==="
npx ts-node -e "import { normalizeFactKey } from './src/core/facts/semantic'; try { console.log(normalizeFactKey('illegal_new_key','real_estate',{} as any)); } catch (e:any) { console.error('EXPECTED_ERR:', e?.message || e); process.exit(0); } console.error('UNEXPECTED: no error'); process.exit(1);"

Write-Host ""
Write-Host "=== IDEMPOTENZ (C) ==="

Write-Host ""
Write-Host "=== IDEMPOTENZ (C) ==="

$uid = "idem-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

# Wir testen die neue Welt:
# - 2x gleicher Call => rawEventId deterministisch gleich
# - facts writes idempotent (gleiches Event => keine erneuten Updates)

$payload = @{
  userId       = $uid
  message      = "Wohnung in Berlin. Kaltmiete 900 EUR."
  dryRun       = $false
  extractorIds = @("real_estate.v1")
}

$r1 = Call-Api $payload
$r2 = Call-Api $payload

if (-not $r1.ok) { throw "IDEMPOTENZ: r1.ok=false" }
if (-not $r2.ok) { throw "IDEMPOTENZ: r2.ok=false" }

$raw1 = $r1.out.rawEvent.rawEventId
$raw2 = $r2.out.rawEvent.rawEventId

"CALL1 rawEventId=$raw1 wrote=$($r1.out.persistence.wrote) factsUpserted=$($r1.out.persistence.counts.factsUpserted)"
"CALL2 rawEventId=$raw2 wrote=$($r2.out.persistence.wrote) factsUpserted=$($r2.out.persistence.counts.factsUpserted)"

if ($raw1 -ne $raw2) { throw "IDEMPOTENZ FAIL: rawEventId differs" }

# Strenger Idempotenz-Check: beim 2. Call sollten keine Facts erneut upserted werden
# (Wenn dein Executor deduped: factsUpserted sollte 0 sein.)
# Falls dein aktueller Executor immer upserted, dann ist das ein echter Bug (updatedAt springt).
if ([int]$r2.out.persistence.counts.factsUpserted -ne 0) {
  throw "IDEMPOTENZ FAIL: expected factsUpserted=0 on second identical call, got $($r2.out.persistence.counts.factsUpserted)"
}

"IDEMPOTENZ OK"

Write-Host ""
Write-Host "=== REAL CHANGE (D) ==="

Write-Host ""
Write-Host "=== REAL CHANGE (D) ==="

$uid = "change-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

# Call 1: 900
$p1 = @{
  userId       = $uid
  message      = "Wohnung in Berlin. Kaltmiete 900 EUR."
  dryRun       = $false
  extractorIds = @("real_estate.v1")
}
$r1 = Call-Api $p1
if (-not $r1.ok) { throw "REAL CHANGE: r1.ok=false" }

Start-Sleep -Seconds 1

# Call 2: 950
$p2 = @{
  userId       = $uid
  message      = "Wohnung in Berlin. Kaltmiete 950 EUR."
  dryRun       = $false
  extractorIds = @("real_estate.v1")
}
$r2 = Call-Api $p2
if (-not $r2.ok) { throw "REAL CHANGE: r2.ok=false" }

"CALL2 wrote=$($r2.out.persistence.wrote) factsUpserted=$($r2.out.persistence.counts.factsUpserted)"

if ([int]$r2.out.persistence.counts.factsUpserted -le 0) {
  throw "REAL CHANGE FAIL: nothing upserted"
}

# Minimal: rent_cold muss 950 sein
$rc = @($r2.out.validatedFacts | Where-Object { $_.key -eq "rent_cold" } | Select-Object -First 1)
if (-not $rc) { throw "REAL CHANGE FAIL: rent_cold missing in validatedFacts" }
if ([int]$rc.value -ne 950) { throw "REAL CHANGE FAIL: rent_cold not 950 (got $($rc.value))" }

"REAL CHANGE OK"

Write-Host ""
Write-Host "=== LATEST (E) ==="

Write-Host ""
Write-Host "=== LATEST (E) ==="

$uid = "latest-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

# Call 1: 900
$p1 = @{
  userId       = $uid
  message      = "Wohnung in Berlin. Kaltmiete 900 EUR."
  dryRun       = $false
  extractorIds = @("real_estate.v1")
}
$r1 = Call-Api $p1
if (-not $r1.ok) { throw "LATEST: r1.ok=false" }

Start-Sleep -Seconds 1

# Call 2: 950
$p2 = @{
  userId       = $uid
  message      = "Wohnung in Berlin. Kaltmiete 950 EUR."
  dryRun       = $false
  extractorIds = @("real_estate.v1")
}
$r2 = Call-Api $p2
if (-not $r2.ok) { throw "LATEST: r2.ok=false" }

# Assertions: validatedFacts müssen 3 sein (doc:summary, rent_cold, city)
if ($r1.out.validatedFacts.Count -ne 3) { throw "LATEST FAIL: expected 3 validatedFacts on call1, got $($r1.out.validatedFacts.Count)" }
if ($r2.out.validatedFacts.Count -ne 3) { throw "LATEST FAIL: expected 3 validatedFacts on call2, got $($r2.out.validatedFacts.Count)" }

function Get-FactByKey($facts, $key) {
  return @($facts | Where-Object { $_.key -eq $key } | Select-Object -First 1)
}

$rc1 = Get-FactByKey $r1.out.validatedFacts "rent_cold"
$rc2 = Get-FactByKey $r2.out.validatedFacts "rent_cold"
$ct1 = Get-FactByKey $r1.out.validatedFacts "city"
$ct2 = Get-FactByKey $r2.out.validatedFacts "city"
$ds1 = Get-FactByKey $r1.out.validatedFacts "doc:summary"
$ds2 = Get-FactByKey $r2.out.validatedFacts "doc:summary"

if (-not $rc1 -or -not $rc2) { throw "LATEST FAIL: rent_cold missing" }
if (-not $ct1 -or -not $ct2) { throw "LATEST FAIL: city missing" }
if (-not $ds1 -or -not $ds2) { throw "LATEST FAIL: doc:summary missing" }

if ([int]$rc2.value -ne 950) { throw "LATEST FAIL: rent_cold not 950 (got $($rc2.value))" }

# "latest"-Contract: factId stabil (weil meta.latest=true in extractor)
if ($rc1.factId -ne $rc2.factId) { throw "LATEST FAIL: rent_cold factId changed (should be stable latest)" }

# city sollte stabil bleiben (value gleich), factId stabil
if ($ct1.factId -ne $ct2.factId) { throw "LATEST FAIL: city factId changed (unexpected)" }
if ($ct1.value -ne $ct2.value) { throw "LATEST FAIL: city value changed (unexpected)" }

# doc:summary ist system+latest => factId stabil
if ($ds1.factId -ne $ds2.factId) { throw "LATEST FAIL: doc:summary factId changed (unexpected)" }

"LATEST OK"

Write-Host ""
Write-Host "=== CLARIFY + REPLY POLICY (F) ==="
Write-Host ""

# 1) Tie-Fall: clarify muss existieren + reply darf nicht leer sein (auch ohne useSatellite Flag)
$uid = "clarify-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

$pTie = @{
  userId = $uid
  message = "egal"
  dryRun = $true
  state = @{
    facts = @(
      @{
        factId="cand-1"; entityId="prop:test-1"; domain="real_estate"; key="rent_cold"; value=1000; source="manual"; createdAt=0; updatedAt=0;
        meta=@{ sourceType="email"; sourceReliability=0.5; confidence=0.5; temporal="present" }
      },
      @{
        factId="cand-2"; entityId="prop:test-1"; domain="real_estate"; key="rent_cold"; value=950; source="manual"; createdAt=0; updatedAt=0;
        meta=@{ sourceType="email"; sourceReliability=0.5; confidence=0.5; temporal="present" }
      }
    )
  }
}

$rTie = Call-Api $pTie
if (-not $rTie.ok) { throw "CLARIFY (Tie): rTie.ok=false" }

if (-not $rTie.out.clarify) { throw "CLARIFY (Tie) FAIL: out.clarify missing" }
if ([string]::IsNullOrWhiteSpace($rTie.reply)) { throw "CLARIFY (Tie) FAIL: reply empty but clarify exists" }

"CLARIFY (Tie) OK"

# 2) Winner-Fall: kein clarify (starker contract gewinnt)
$uid = "winner-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

$pWin = @{
  userId = $uid
  message = "egal"
  dryRun = $true
  state = @{
    facts = @(
      @{
        factId="cand-1"; entityId="prop:test-1"; domain="real_estate"; key="rent_cold"; value=1000; source="manual"; createdAt=0; updatedAt=0;
        meta=@{ sourceType="contract"; sourceReliability=0.95; confidence=0.95; temporal="present" }
      },
      @{
        factId="cand-2"; entityId="prop:test-1"; domain="real_estate"; key="rent_cold"; value=950; source="manual"; createdAt=0; updatedAt=0;
        meta=@{ sourceType="email"; sourceReliability=0.5; confidence=0.5; temporal="present" }
      }
    )
  }
}

$rWin = Call-Api $pWin
if (-not $rWin.ok) { throw "CLARIFY (Winner): rWin.ok=false" }
if ($rWin.out.clarify) { throw "CLARIFY (Winner) FAIL: out.clarify should be null/undefined" }

"CLARIFY (Winner) OK"

# 3) INGEST: Brain AUS → reply = "Gespeichert."
$uid = "ingest-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

$pIngest = @{
  userId = $uid
  message = "INGEST: Sag Hallo in einem Satz."
  dryRun = $true
  extractorIds = @("real_estate.v1")
}

$rIngest = Call-Api $pIngest
if (-not $rIngest.ok) { throw "INGEST: rIngest.ok=false" }

if ($rIngest.reply -ne "Gespeichert.") { throw "INGEST FAIL: expected reply='Gespeichert.' got '$($rIngest.reply)'" }

"INGEST OK"

Write-Host ""
Write-Host "PHASE 1.1 SUITE DONE"