\# CORE\_DEFINITION — ANORA



Status: \*\*FROZEN\*\*

Gültig ab: Phase 0.1  

Zweck: Eindeutige, überprüfbare Abgrenzung des Anora-Core.



---



\## 1. Ziel des Core



Der Anora-Core ist eine \*\*deterministische Truth Engine\*\*.



Er hat genau eine Aufgabe:

> Aus Input stabile, überprüfbare interne Wahrheit (Facts + Haltung + History) erzeugen.



Nicht:

\- Unterhaltung

\- UX

\- Persönlichkeit

\- Planung

\- Interpretation von Wichtigkeit

\- Ranking oder Priorisierung



---



\## 2. Was ist Core (verbindlich)



\### 2.1 Datenebenen

\- \*\*RawEvents\*\*

&nbsp; - deterministisch erzeugt

&nbsp; - append-only

\- \*\*Facts (`facts\_v1`)\*\*

&nbsp; - latest-only Semantik

&nbsp; - deterministische FactId

&nbsp; - supersede-fähig

\- \*\*Evidence (`evidence\_v1`)\*\*

&nbsp; - Provenance (warum / wann ein Fact galt)

\- \*\*Entities\*\*

&nbsp; - rein über Fingerprints

&nbsp; - keine automatische Zusammenlegung

\- \*\*Relations\*\*

&nbsp; - vorgesehen, aktuell leer



\### 2.2 Verarbeitung

\- \*\*runCoreOnce\*\*

&nbsp; - pure Funktion

&nbsp; - kein Firestore

&nbsp; - keine Side-Effects

\- \*\*runCoreWithPersistence\*\*

&nbsp; - erzeugt WritePlan

&nbsp; - ruft Executor

\- \*\*executeWritePlanV1\*\*

&nbsp; - einzige Stelle mit Writes

&nbsp; - strikt nach WritePlan



\### 2.3 Haltung

\- numerisch

\- intern

\- deterministisch

\- kein Text, kein Prompt

\- Änderungen nur über explizite Trigger



\### 2.4 Intervention

\- deterministisch

\- rein ableitend aus Haltung + Triggern

\- keine Speicherung eigener Meinung



---



\## 3. Was ist explizit NICHT Core



\- UI / Frontend

\- Chatflow-Logik

\- Personas / Tonalität

\- Presence-Feintuning

\- Planner / v2-Inference

\- Tasks als Feature

\- Wichtigkeits- oder Relevanz-Ranking

\- Aggregierte Zusammenfassungen

\- Indexe mit impliziter Bedeutung



---



\## 4. Harte Core-Regeln (Contracts)



\### 4.1 Determinismus

Identischer Input ⇒ identischer Output (Core-Ebene).



\### 4.2 Reinheit

\- `runCoreOnce` ist \*\*pure\*\*

\- kein Firestore

\- keine Zeitabhängigkeit

\- kein globaler Zustand



\### 4.3 Write-Zone

\- \*\*NUR\*\* `executeWritePlanV1` darf schreiben

\- alle Writes müssen im WritePlan stehen



\### 4.4 Satelliten

\- `extractorIds: \[]` ⇒ \*\*keine Fact-Writes\*\*

\- Satelliten dürfen:

&nbsp; - lesen

&nbsp; - fragen

&nbsp; - reagieren

\- Satelliten dürfen NICHT:

&nbsp; - speichern

&nbsp; - priorisieren

&nbsp; - interpretieren



\### 4.5 Freeze

\- FactKeys, Domains, Extractors sind gefroren  

&nbsp; → siehe `CORE\_FREEZE.ts`

\- Indexe sind gefroren  

&nbsp; → siehe `INDEX\_FREEZE.md`



---



\## 5. Source-of-Truth Dokumente



Diese Dateien definieren den Core gemeinsam:



\- `CORE\_DEFINITION.md` (dieses Dokument)

\- `CORE\_FREEZE.ts`

\- `CORE\_GUARDRAILS.md`

\- `INDEX\_FREEZE.md`

\- `SUPERSede\_MODEL.md`



Bei Widerspruch gilt:

> \*\*CORE\_DEFINITION.md schlägt alles.\*\*



---



\## 6. Änderungsregel



Änderungen am Core sind nur erlaubt, wenn:

1\. Sie explizit einer Roadmap-Phase zugeordnet sind

2\. Sie durch Tests abgesichert sind

3\. Sie diese Definition nicht verletzen



Alles andere ist \*\*out of scope\*\*.

