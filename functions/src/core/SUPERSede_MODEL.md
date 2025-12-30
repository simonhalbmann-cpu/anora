\# SUPERSede Model (Core)



Ziel:

\- Wenn ein Fact ersetzt wird (latest semantics), bleibt Provenance erhalten.

\- Facts sind “current truth”; Evidence ist “why/when it was true”.



Regeln:

\- Facts (facts\_v1):

&nbsp; - pro (entityId, key) genau 1 doc mit `meta.latest=true` (latest-only)

&nbsp; - FactId wird stabil über (entityId + key + "\_\_latest\_\_") gebildet

\- Evidence (evidence\_v1):

&nbsp; - pro (factId, sourceRef) genau 1 Evidence-Dokument

&nbsp; - Evidence enthält sourceRef/rawEventId + ggf. extractorId + timestamps



Konsequenz:

\- `sourceRef` ist nicht mehr zwingend im Fact selbst nötig, weil Evidence die Provenance trägt.

