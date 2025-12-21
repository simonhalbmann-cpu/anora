# ANORA Core – Scope (verbindlich)

## Ziel
Der Anora Core ist der einzige Ort, an dem persistenter Zustand entsteht.
Satelliten sind austauschbar und besitzen keinen eigenen Kontext.

## Core gehört dazu (Code-Module)
- core/rawEvents/**
- core/entities/**
- core/facts/**
- core/runner/**
- core/persistence/** (nur wenn es ausschließlich Core-Store nutzt)
- core/utils/**
- Observability: processing.v1 am RawEvent (mark start/done/error, patch feldweise)

## Satelliten (nicht Core)
- domains/**
- prompt/**
- scripts/** (außer Tests/Golden)
- Presence-Logik außerhalb Core-Stores
- Mobile/UI (außerhalb functions)

## Core-Collections (Firestore)
- brain/{userId}/rawEvents/{rawEventId}
- brain/{userId}/facts_v1/{factId}
- brain/{userId}/evidence_v1/{evidenceId}
- brain/{userId}/entities_v1/{entityId} (falls vorhanden, sonst: TBD)

## Legacy / Übergang (NICHT als Core-Truth)
- brain/{userId}/facts  (Legacy oder Übergangscollection – darf nicht parallel zur v1-Wahrheit existieren)

## Prinzip
Single Source of Truth:
Facts haben genau eine Wahrheit (entweder facts oder facts_v1), niemals beides parallel.