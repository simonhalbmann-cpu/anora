# CORE_CLEAN_DONE — ANORA (FINAL)

Stand: 2026-01-08  
Status: CORE-SAUBER (abgeschlossen). Core wird ab jetzt nicht mehr feature-mäßig verändert.

---

## 1) HARTE GRUNDREGEL
Alles, was nicht den Anora-Core stabilisiert oder Bugs im Core behebt, wird NICHT im Core angefasst.

Core ist:
- langweilig
- deterministisch
- testbar
- ohne Magie
- ohne LLM/Prompts
- ohne UI
- ohne Aggregation/Ranking

---

## 2) CORE-DEFINITION (WAS IST CORE)
Core umfasst ausschließlich:
- RawEvents (Eingangsdaten / Ingest-Events)
- Facts (facts_v1) inkl. Lifecycle (latest-only + supersedes)
- Entities (Resolver: keine Magie, keine Auto-Merges ohne Fingerprint)
- Relations (aktuell leer/vorgesehen)
- Processing / Observability (Debug/Trace, deterministische Ausgaben)
- Haltung (intern, numerisch, deterministisch)
- Interventions-Controller (observe|hint|recommend|contradict) als Core-Entscheidung (keine Texte)

Core liefert:
- writePlan (was WOULD passieren)
- persistence counts (was DID passieren, wenn executor läuft)
- intervention (Level + reasonCodes, deterministisch)

---

## 3) NICHT CORE (EXPLIZIT AUSSERHALB)
Nicht Core ist alles, was:
- Texte formuliert (Antwort-Generation)
- LLMs aufruft oder Prompts enthält
- UI/Frontend
- Personas/Presence/Marketing
- Chatflow-Logik als Feature
- Tasks als Feature
- Dokument-Extras

Wichtig:
Satellites sind NICHT Core.
Sie dürfen lesen + reagieren, aber NICHT speichern, NICHT priorisieren, NICHT interpretieren.

---

## 4) TECHNISCHE CORE-GRENZE (IMPORT-REGELN)
### 4.1 Pure Core darf NICHT importieren
Diese Dateien/Schichten dürfen NICHT von Pure-Core-Dateien importiert werden:
- `src/core/bridge.ts` (IMPURE bridge, env, OpenAI, firebase-functions/v2)
- `src/core/satellites/**` (LLM Brain, Contracts, Satellite-Typen)
- firebase-admin / firestore / env / OpenAI Clients

### 4.2 Pure Core Dateien (müssen sauber bleiben)
Insbesondere:
- `src/core/runCoreOnce.ts`
- `src/core/runCoreWithPersistence.ts`

Diese dürfen KEINE LLM Calls machen und KEINE Side-Effects auslösen.

### 4.3 IMPURE Bereiche (dürfen Side-Effects haben)
- `src/core/bridge.ts` = bewusst impure (env, OpenAI, infra wiring)
- `src/entry/apiHandler.ts` = HTTP Entry; darf Satellite anwerfen
- Persistence Executor Layer = schreibt nur nach explizitem WritePlan

---

## 5) SATELLITE-REGELN (FINAL)
Satellites dürfen:
- input lesen (facts/history/contexts)
- eine Antwort formulieren (reply)
- optional actions/tasks zurückgeben (wenn erlaubt)

Satellites dürfen NICHT:
- Facts speichern
- writePlan ausführen
- Firestore/Admin importieren
- Ranking/Priorisierung/Aggregation betreiben
- neue Core-Facts erzeugen (Final: newFacts leer)

Final umgesetzt:
- `llmBrain.ts` normalisiert strict:
  - reply muss string + nicht leer sein
  - newFacts/actions/tasks werden final auf `[]` gesetzt
  - Contract-Verletzung → fallback (invalidJson)

---

## 6) AKTUELLER STATUS ROADMAP (CORE)
PHASE 0 — Inventur/Definition: ERLEDIGT  
PHASE 1 — Facts/Entities Kern: ERLEDIGT  
PHASE 2 — Index leer machen / Satelliten entkernen: ERLEDIGT  
PHASE 3 — Lifecycle + History deterministisch: ERLEDIGT  
PHASE 4 — Adaptive Core-Haltung deterministisch: ERLEDIGT  
PHASE 5 — Interventions-Level vorhanden (Controller): (Core-Teil: ERLEDIGT)  
PHASE 6 — Stabilitätstests:
- 6.1 Zeit-Test: PASSED (deterministisch, 100 Interaktionen, keine Facts)
- 6.2 Missbrauchs-Test: PASSED (deterministisch, Core stabil)

=> Ergebnis: Core ist stabil + deterministisch + ohne Satellites konsistent.

---

## 7) AB JETZT: WAS DARF NOCH IM CORE PASSIEREN?
Erlaubt im Core:
- Bugfixes, die Determinismus/Stabilität/Tests reparieren
- kleine refactors, die nur Klarheit schaffen, ohne Verhalten zu ändern
- neue Tests, die bestehende Regeln härter absichern

Nicht erlaubt im Core:
- neue Features
- neue LLM-Integrationen
- neue Prompts/Antwortlogik
- neue “Hilfslogik”, die Prioritäten/Indexing wieder einführt

---

## 8) „CORE SAUBER MACHEN“ — BEURTEILUNG
Ja: Nach diesem Stand ist die Roadmap „Core sauber machen“ abgeschlossen.

Kriterium:
- Pure Core importiert weder bridge noch satellites ✅
- Satellites schreiben nichts ✅
- Tests 6.1 + 6.2 deterministisch ✅
- Emulator/Build grün ✅

ENDE.