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

Write-Host "=== BUILD + GOLDEN ==="
Set-Location $functions

npm run build
npx ts-node .\src\scripts\runGoldenTest.ts

Write-Host ""
Write-Host "=== CORE FREEZE NEG ==="
npx ts-node -e "import { normalizeFactKey } from './src/core/facts/semantic'; try { console.log(normalizeFactKey('illegal_new_key','real_estate',{} as any)); } catch (e:any) { console.error('EXPECTED_ERR:', e?.message || e); process.exit(0); } console.error('UNEXPECTED: no error'); process.exit(1);"

Write-Host ""
Write-Host "=== IDEMPOTENZ (C) ==="

$uid = "idem-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$body = @{
  userId = $uid
  text   = "Wohnung in Berlin. Kaltmiete 900 EUR."
  locale = "de-DE"
  meta   = @{ filename="idem.txt"; source="idem-test" }
} | ConvertTo-Json -Depth 10

"USER_ID=$uid"

# Ingest #1
$r1 = Invoke-RestMethod -Method Post -Uri "$base/ingestRawDocumentText" -ContentType "application/json" -Body $body
if (-not $r1.rawEventId) { throw "INGEST1 failed / no rawEventId" }
"INGEST1 rawEventId=$($r1.rawEventId) isDuplicate=$($r1.isDuplicate)"

# Ingest #2 identisch -> duplicate=true erwartet
$r2 = Invoke-RestMethod -Method Post -Uri "$base/ingestRawDocumentText" -ContentType "application/json" -Body $body
if (-not $r2.rawEventId) { throw "INGEST2 failed / no rawEventId" }
"INGEST2 rawEventId=$($r2.rawEventId) isDuplicate=$($r2.isDuplicate) duplicateOf=$($r2.duplicateOf)"

if ($r1.rawEventId -ne $r2.rawEventId) { throw "DEDUPE FAIL: rawEventId differs" }

# Runner #1
$run1 = Invoke-RestMethod -Method Post -Uri "$base/runAllExtractorsOnRawEventV1" -ContentType "application/json" -Body (@{ userId=$uid; rawEventId=$r1.rawEventId } | ConvertTo-Json -Depth 10)
"RUN1 ok=$($run1.ok) upserted=$($run1.upserted) skipped=$($run1.skipped)"

# Facts lesen (#1)
$f1 = Invoke-RestMethod -Method Post -Uri "$base/listFactsV1" -ContentType "application/json" -Body (@{ userId=$uid; domain="real_estate"; limit=50 } | ConvertTo-Json -Depth 10)
$items1 = @($f1.items | % { [PSCustomObject]@{ id=$_.id; key=$_.data.key; updatedAt=[int64]$_.data.updatedAt } } | Sort-Object id)
"FACTS1 count=$($items1.Count) keys=$(@($items1 | % key) -join ', ')"

Start-Sleep -Seconds 1

# Runner #2 identisch (selber rawEvent) -> upserted=0 erwartet + updatedAt bleibt stabil
$run2 = Invoke-RestMethod -Method Post -Uri "$base/runAllExtractorsOnRawEventV1" -ContentType "application/json" -Body (@{ userId=$uid; rawEventId=$r1.rawEventId } | ConvertTo-Json -Depth 10)
"RUN2 ok=$($run2.ok) upserted=$($run2.upserted) skipped=$($run2.skipped)"

# Facts lesen (#2)
$f2 = Invoke-RestMethod -Method Post -Uri "$base/listFactsV1" -ContentType "application/json" -Body (@{ userId=$uid; domain="real_estate"; limit=50 } | ConvertTo-Json -Depth 10)
$items2 = @($f2.items | % { [PSCustomObject]@{ id=$_.id; key=$_.data.key; updatedAt=[int64]$_.data.updatedAt } } | Sort-Object id)
"FACTS2 count=$($items2.Count) keys=$(@($items2 | % key) -join ', ')"

if (($items1.id -join ",") -ne ($items2.id -join ",")) { throw "IDEMPOTENZ FAIL: fact IDs changed" }

$changed=@()
for ($i=0; $i -lt $items1.Count; $i++) {
  if ($items1[$i].updatedAt -ne $items2[$i].updatedAt) { $changed += $items1[$i].id }
}
if ($changed.Count -gt 0) { throw "IDEMPOTENZ FAIL: updatedAt changed for: $($changed -join ', ')" }

"IDEMPOTENZ OK"

Write-Host ""
Write-Host "=== REAL CHANGE (D) ==="

$uid = "change-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

# INGEST 1 (900)
$body1=@{
  userId=$uid
  text="Wohnung in Berlin. Kaltmiete 900 EUR."
  locale="de-DE"
  meta=@{ filename="change.txt"; source="change-test" }
} | ConvertTo-Json -Depth 10

$r1 = Invoke-RestMethod -Method Post -Uri "$base/ingestRawDocumentText" -ContentType "application/json" -Body $body1
$run1 = Invoke-RestMethod -Method Post -Uri "$base/runAllExtractorsOnRawEventV1" -ContentType "application/json" -Body (@{ userId=$uid; rawEventId=$r1.rawEventId } | ConvertTo-Json -Depth 10)

$f1 = Invoke-RestMethod -Method Post -Uri "$base/listFactsV1" -ContentType "application/json" -Body (@{ userId=$uid; domain="real_estate"; limit=50 } | ConvertTo-Json -Depth 10)
$items1 = @($f1.items | % { [PSCustomObject]@{ key=$_.data.key; updatedAt=[int64]$_.data.updatedAt } } | Sort-Object key)

Start-Sleep -Seconds 1

# INGEST 2 (950) -> echte Änderung => updatedAt muss springen (mindestens rent_cold)
$body2=@{
  userId=$uid
  text="Wohnung in Berlin. Kaltmiete 950 EUR."
  locale="de-DE"
  meta=@{ filename="change.txt"; source="change-test" }
} | ConvertTo-Json -Depth 10

$r2 = Invoke-RestMethod -Method Post -Uri "$base/ingestRawDocumentText" -ContentType "application/json" -Body $body2
$run2 = Invoke-RestMethod -Method Post -Uri "$base/runAllExtractorsOnRawEventV1" -ContentType "application/json" -Body (@{ userId=$uid; rawEventId=$r2.rawEventId } | ConvertTo-Json -Depth 10)
"RUN2 ok=$($run2.ok) upserted=$($run2.upserted) skipped=$($run2.skipped)"

if ([int]$run2.upserted -le 0) { throw "REAL CHANGE FAIL: nothing upserted" }

$f2 = Invoke-RestMethod -Method Post -Uri "$base/listFactsV1" -ContentType "application/json" -Body (@{ userId=$uid; domain="real_estate"; limit=50 } | ConvertTo-Json -Depth 10)
$items2 = @($f2.items | % { [PSCustomObject]@{ key=$_.data.key; updatedAt=[int64]$_.data.updatedAt } } | Sort-Object key)

$updatedKeys = @()
foreach ($it1 in $items1) {
  $it2 = $items2 | Where-Object { $_.key -eq $it1.key } | Select-Object -First 1
  if ($it2 -and $it2.updatedAt -ne $it1.updatedAt) { $updatedKeys += $it1.key }
}

if ($updatedKeys.Count -eq 0) { throw "REAL CHANGE FAIL: updatedAt did NOT change for any key" }
if (-not ($updatedKeys -contains "rent_cold")) { throw "REAL CHANGE FAIL: rent_cold was NOT updated" }

"UPDATED KEYS: $($updatedKeys -join ', ')"
"REAL CHANGE OK"

Write-Host ""
Write-Host "=== LATEST (E) ==="

$uid = "latest-" + [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
"USER_ID=$uid"

# 1) 900 EUR (SAME filename!)
$body1=@{
  userId=$uid
  text="Wohnung in Berlin. Kaltmiete 900 EUR."
  locale="de-DE"
  meta=@{ filename="phase11.txt"; source="phase11-test" }
} | ConvertTo-Json -Depth 10

$r1 = Invoke-RestMethod -Method Post -Uri "$base/ingestRawDocumentText" -ContentType "application/json" -Body $body1
$run1 = Invoke-RestMethod -Method Post -Uri "$base/runAllExtractorsOnRawEventV1" -ContentType "application/json" -Body (@{ userId=$uid; rawEventId=$r1.rawEventId } | ConvertTo-Json -Depth 10)
"RUN1 ok=$($run1.ok) upserted=$($run1.upserted) skipped=$($run1.skipped)"

$f1 = Invoke-RestMethod -Method Post -Uri "$base/listFactsV1" -ContentType "application/json" -Body (@{ userId=$uid; domain="real_estate"; limit=50 } | ConvertTo-Json -Depth 10)
$items1 = @($f1.items | % { [PSCustomObject]@{ id=$_.id; key=$_.data.key; value=$_.data.value; updatedAt=[int64]$_.data.updatedAt } } | Sort-Object key)

Start-Sleep -Seconds 1

# 2) 950 EUR (SAME filename!)
$body2=@{
  userId=$uid
  text="Wohnung in Berlin. Kaltmiete 950 EUR."
  locale="de-DE"
  meta=@{ filename="phase11.txt"; source="phase11-test" }
} | ConvertTo-Json -Depth 10

$r2 = Invoke-RestMethod -Method Post -Uri "$base/ingestRawDocumentText" -ContentType "application/json" -Body $body2
$run2 = Invoke-RestMethod -Method Post -Uri "$base/runAllExtractorsOnRawEventV1" -ContentType "application/json" -Body (@{ userId=$uid; rawEventId=$r2.rawEventId } | ConvertTo-Json -Depth 10)
"RUN2 ok=$($run2.ok) upserted=$($run2.upserted) skipped=$($run2.skipped)"

$f2 = Invoke-RestMethod -Method Post -Uri "$base/listFactsV1" -ContentType "application/json" -Body (@{ userId=$uid; domain="real_estate"; limit=50 } | ConvertTo-Json -Depth 10)
$items2 = @($f2.items | % { [PSCustomObject]@{ id=$_.id; key=$_.data.key; value=$_.data.value; updatedAt=[int64]$_.data.updatedAt } } | Sort-Object key)

# Assertions:
if ($items1.Count -ne 3) { throw "LATEST FAIL: expected 3 facts after RUN1, got $($items1.Count)" }
if ($items2.Count -ne 3) { throw "LATEST FAIL: expected 3 facts after RUN2, got $($items2.Count)" }

function Get-ByKey($items, $key) {
  return ($items | Where-Object { $_.key -eq $key } | Select-Object -First 1)
}

$rc1  = Get-ByKey $items1 "rent_cold"
$rc2  = Get-ByKey $items2 "rent_cold"
$ct1  = Get-ByKey $items1 "city"
$ct2  = Get-ByKey $items2 "city"
$ds1  = Get-ByKey $items1 "doc:summary"
$ds2  = Get-ByKey $items2 "doc:summary"

if (-not $rc1 -or -not $rc2) { throw "LATEST FAIL: rent_cold missing" }
if (-not $ct1 -or -not $ct2) { throw "LATEST FAIL: city missing" }
if (-not $ds1 -or -not $ds2) { throw "LATEST FAIL: doc:summary missing" }

# rent_cold: muss überschreiben, FactId stabil bleiben, updatedAt springen
if ([int]$rc2.value -ne 950) { throw "LATEST FAIL: rent_cold not updated to 950 (got $($rc2.value))" }
if ($rc1.id -ne $rc2.id) { throw "LATEST FAIL: rent_cold factId changed (should be stable latest)" }
if ($rc1.updatedAt -eq $rc2.updatedAt) { throw "LATEST FAIL: rent_cold updatedAt did not change on real update" }

# FactIds müssen stabil bleiben (latest-only FactId bleibt gleich)
# - city soll NOOP sein (updatedAt stabil)
# - doc:summary darf sich inhaltlich ändern, aber FactId muss stabil bleiben
if ($ct1.id -ne $ct2.id) { throw "LATEST FAIL: city factId changed (unexpected)" }
if ($ds1.id -ne $ds2.id) { throw "LATEST FAIL: doc:summary factId changed (unexpected)" }

$changedKeys = @()
foreach ($k in @("rent_cold","city","doc:summary")) {
  $a = Get-ByKey $items1 $k
  $b = Get-ByKey $items2 $k
  if ($a.updatedAt -ne $b.updatedAt) { $changedKeys += $k }
}

"UPDATED KEYS (LATEST): $($changedKeys -join ', ')"

# Harter Contract: genau 1 Key darf springen: rent_cold
# Akzeptierter Contract:
# - city darf NICHT springen (soll NOOP bleiben)
# - rent_cold MUSS springen (echtes Update)
# - doc:summary DARF springen (weil Summary von Text abhängt und sich mit Miete ändern kann)

if ($changedKeys -contains "city") {
  throw "LATEST FAIL: city must be NOOP across events, but updatedAt changed"
}
if (-not ($changedKeys -contains "rent_cold")) {
  throw "LATEST FAIL: rent_cold must update, but did not"
}

# Optional: doc:summary darf nur dann springen, wenn auch rent_cold gesprungen ist
if (($changedKeys -contains "doc:summary") -and -not ($changedKeys -contains "rent_cold")) {
  throw "LATEST FAIL: doc:summary changed but rent_cold did not (unexpected coupling)"
}

# Optional strenger: es dürfen nur rent_cold (+ optional doc:summary) springen
$allowed = @("rent_cold","doc:summary")
$unexpected = @($changedKeys | Where-Object { $allowed -notcontains $_ })
if ($unexpected.Count -gt 0) {
  throw "LATEST FAIL: unexpected updated keys: $($unexpected -join ', ') (all updated: $($changedKeys -join ', '))"
}

# Optional: zusätzlich run2.upserted hart machen (erst aktivieren, wenn du willst)
# if ([int]$run2.upserted -ne 1) { throw "LATEST FAIL: expected run2.upserted=1, got $($run2.upserted)" }

"LATEST OK"

Write-Host ""
Write-Host "PHASE 1.1 SUITE DONE"