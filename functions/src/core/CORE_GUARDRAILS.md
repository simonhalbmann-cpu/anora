# ANORA Core – Guardrails (Freeze-Regeln)

## BAUEN-Modus

Keine neuen Features, keine UI, keine Visionen.
Nur Core-Bereinigung, Stabilität, Tests.

## Persistenz-Regel

Jede Persistenz im Core erfolgt ausschließlich über:

* core/rawEvents/store.ts
* core/facts/store.ts
* core/entities/store.ts

Direkte Firestore-Writes auf Core-Collections außerhalb dieser Stores sind verboten.

## Facts – Single Source of Truth

Es darf nur eine Facts-Collection als Wahrheit geben:

* Entweder brain/{userId}/facts (Legacy)
* Oder brain/{userId}/facts\_v1 (v1)

Parallelbetrieb ist verboten.

## Schema/Keys/Domains – Freeze

* Keine neuen Fact Keys ohne Registry-Prozess
* Keine neuen Domains
* Keine neuen Extractors
* Keine Änderungen an FactId-Logik ohne Golden Tests Update

## Observability

processing.v1 wird feldweise gepatcht (kein overwrite des Gesamtobjekts).
Jeder Run muss Start/Done/Error sauber setzen.

## Guard: Core must not depend on Indexing

- No imports from `src/indexing/**`
- No calls to entity resolvers
- Facts must enter persistence with entityId already resolved





