\# INDEX FREEZE (Core)



Status: FROZEN



Regel:

\- Keine neuen Firestore Indexe / Query-Patterns ohne expliziten Roadmap-Schritt + Test.

\- Änderungen an `firestore.indexes.json` nur, wenn:

&nbsp; 1) Ein Test das erzwingt (reproduzierbar),

&nbsp; 2) Der Index minimal ist,

&nbsp; 3) Der Grund hier dokumentiert ist.



Warum:

\- Index-Wachstum ist „unsichtbare Komplexität“ und erzeugt Folgekosten.

\- Core bleibt deterministisch; Queries bleiben bewusst begrenzt.

