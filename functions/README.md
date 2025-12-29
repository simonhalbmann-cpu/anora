# Anora Functions – Core

## Core-Fokus (eingefroren)
Harte Regel: Alles, was nicht der Stabilisierung des Anora-Core dient, wird nicht angefasst.

Eingefroren:
- UI (8.x)
- v2 Inference / Planner
- Presence-Feintuning
- Dokument-Extras
- Marketing / Personas / Pricing

Aktiver Fokus:
- Core-Stabilisierung
- Phase 1.1 Test-Suite


## Phase 1.1 – „latest-only“ Lifecycle (verifiziert)
Phase 1.1 ist durch reale Emulator-Integrationstests abgesichert.

Abgedeckte Contracts:
- Golden Test: deterministischer Minimal-Core-Output
- Core Freeze (NEG): nicht erlaubte Fact-Keys werden hart rejected
- Idempotenz: gleicher Ingest → kein Write, IDs & updatedAt stabil
- Real Change: Wertänderung → Write + updatedAt springt
- Latest-only: pro (entityId, key) stabile FactId, Value wird überschrieben
- Provenance: Event-Zuordnung erfolgt ausschließlich über evidence_v1


## Voraussetzungen
- Node.js / npm
- Firebase CLI
- Java 21 (firebase-tools >= 15)


## Emulator starten (Repo-Root: anora-app)
Wichtig: Emulator-Start ist nur zuverlässig mit explizitem --config.

```bash
firebase emulators:start --project anoraapp-ai --config "C:\users\simon\documents\anora-work\anora-app\firebase.json"