# ANORA CORE — Definition (frozen)

## Core umfasst ausschließlich
- RawEvents
  - Pfad: brain/{userId}/rawEvents
- Facts (Single Source of Truth)
  - Pfad: brain/{userId}/facts_v1
- Evidence (falls aktiv genutzt)
  - Pfad: brain/{userId}/evidence_v1
- Entities
  - Pfade: brain/{userId}/entities_v1, brain/{userId}/entity_map_v1
- Relations (leer, vorgesehen)
- Processing / Observability
  - Pfad: brain/{userId}/rawEvents/* (processing.*)
- Haltung (intern, numerisch)
  - Pfad: brain/{userId}/core_haltung/v1

## Nicht-Core (eingefroren)
- UI (8.x)
- Chatflow-Logik / Conversation UX
- Personas / Presence / Tonalität
- Tasks als Feature
- v2 Inference / Planner
- Dokument-Extras
- Marketing / Pricing

## GRUNDREGEL (hart)
Alles, was nicht den Anora-Core stabilisiert, wird nicht angefasst.

## Index-Freeze (Phase 0.2)
Bis Phase 2 abgeschlossen ist:
- Keine neuen Keys
- Keine neuen Domains
- Keine neuen Extractors
- Keine neuen Fact-Typen

## Abbruchkriterium Phase 0
- Jeder kann in 5 Minuten erklären, was Core ist (dieses Dokument genügt).
