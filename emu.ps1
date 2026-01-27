# emu.ps1
param(
  [string]$ProjectDir = "C:\users\simon\documents\anora-work\anora-app",
  [string]$StableDir  = "C:\_emu\anoraapp-ai",
  [string]$ProjectId  = "anoraapp-ai"
)

Set-Location $ProjectDir

# firebase.cmd sauber ermitteln (Windows)
$firebaseAny = (Get-Command firebase).Source
$firebaseDir = Split-Path -Parent $firebaseAny
$FirebaseCmd = Join-Path $firebaseDir "firebase.cmd"

if (-not (Test-Path $FirebaseCmd)) {
  throw "firebase.cmd nicht gefunden neben: $firebaseAny"
}

Write-Host ("FIREBASE BIN: " + $FirebaseCmd) -ForegroundColor DarkGray
Write-Host ("FIREBASE BIN: " + $FirebaseCmd) -ForegroundColor DarkGray

# Stabiler Import-Ordner (existiert immer)
New-Item -ItemType Directory -Path $StableDir -Force | Out-Null

function Copy-ExportToStable {
  param(
    [string]$FromDir,
    [string]$ToDir
  )

  $meta = Join-Path $FromDir "firestore_export\firestore_export.overall_export_metadata"
  if (-not (Test-Path $meta)) {
    Write-Host ("COPY-EXPORT: Quelle ungueltig (keine overall_export_metadata): " + $FromDir) -ForegroundColor Yellow
    return
  }

  Write-Host ("COPY-EXPORT: Quelle=" + $FromDir) -ForegroundColor Cyan

  foreach ($p in @("auth_export","firestore_export","firebase-export-metadata.json")) {
    $t = Join-Path $ToDir $p
    if (Test-Path $t) { Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue }
  }

  Copy-Item (Join-Path $FromDir "auth_export")      -Destination $ToDir -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $FromDir "firestore_export") -Destination $ToDir -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $FromDir "firebase-export-metadata.json") -Destination $ToDir -Force -ErrorAction SilentlyContinue

  Write-Host ("COPY-EXPORT: OK -> " + $ToDir) -ForegroundColor Green
}

try {
  Write-Host ("START: firebase emulators:start --config .\firebase.json --only firestore,auth,functions --import " + $StableDir) -ForegroundColor Cyan

  & $FirebaseCmd emulators:start `
    --config ".\firebase.json" `
    --only "firestore,auth,functions" `
    --import $StableDir
}
finally {
  # 1) Export triggern (auch wenn EPERM kommt: firebase-export-* wird oft trotzdem erzeugt)
  $trigger = Join-Path $ProjectDir ("__export-trigger-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Write-Host ("COPY-EXPORT: trigger emulators:export -> " + $trigger) -ForegroundColor Cyan

  try {
    & $FirebaseCmd emulators:export $trigger --project $ProjectId | Out-Null
  } catch {
    # absichtlich ignorieren (EPERM/rename auf Windows)
  }

  # 2) Neueste firebase-export-* Quelle suchen
  $latest = Get-ChildItem $ProjectDir -Directory -Force |
    Where-Object Name -like "firebase-export-*" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latest) {
    Write-Host "COPY-EXPORT: KEINE Quelle gefunden (kein firebase-export-*)" -ForegroundColor Yellow
  }
  else {
    Copy-ExportToStable -FromDir $latest.FullName -ToDir $StableDir
  }
}