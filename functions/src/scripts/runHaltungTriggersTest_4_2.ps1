# functions/src/scripts/runHaltungTriggersTest_4_2.ps1
$ErrorActionPreference = "Stop"

$project="anoraapp-ai"
$region="us-central1"
$api="http://127.0.0.1:5001/$project/$region/api"

function Call-Core($userId, $msg) {
  $body=@{ userId=$userId; message=$msg; dryRun=$true } | ConvertTo-Json -Depth 10
  return Invoke-RestMethod -Method Post -Uri $api -ContentType "application/json" -Body $body
}

# 1) decision_near
$userId="triggers-decision-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$r = Call-Core $userId "Soll ich den Vertrag unterschreiben?"
if ($r.ok -ne $true) { throw "API not ok" }
if ($r.out.haltungDelta.triggers.hasTrigger -ne $true) { throw "expected hasTrigger=true" }
if (-not ($r.out.haltungDelta.triggers.triggers -contains "decision_near")) { throw "missing decision_near" }

# 2) escalation_marker
$userId="triggers-escal-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$r = Call-Core $userId "Mach Druck. Jetzt reicht's. Ich will das eskalieren."
if ($r.ok -ne $true) { throw "API not ok" }
if (-not ($r.out.haltungDelta.triggers.triggers -contains "escalation_marker")) { throw "missing escalation_marker" }

# 3) neutral
$userId="triggers-none-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$r = Call-Core $userId "Hallo."
if ($r.ok -ne $true) { throw "API not ok" }
if ($r.out.haltungDelta.triggers.hasTrigger -ne $false) { throw "expected hasTrigger=false" }
if ($r.out.haltungDelta.triggers.triggers.Count -ne 0) { throw "expected no triggers" }

"OK: triggers test passed"