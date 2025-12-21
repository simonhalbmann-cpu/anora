// functions/src/anoracopy.ts

// 1) Presence-Karten (UI Copy)
export const PRESENCE_COPY_DE = {
  stress_hint: {
    message:
      "Du hast in letzter Zeit mehrfach von Konflikten, Druck oder Stress gesprochen. Willst du diese offenen Punkte einmal sortieren?",
  },
  decision_followup: {
    message:
      "Du arbeitest gerade an einer größeren finanziellen oder immobilienbezogenen Entscheidung. Willst du Risiken und Optionen dazu einmal strukturiert durchgehen?",
  },
  project_nudging: {
    message:
      "Es gibt offene Aufgaben aus deinen letzten Entscheidungen. Willst du dir jetzt einen Moment nehmen, um einen davon anzustoßen?",
  },
} as const;

// 2) Rent-Flow (Spezialantworten)
export const RENT_COPY_DE = {
  unknownTenantPronoun:
    'Ich bin mir gerade nicht sicher, welchen Mieter du mit "sie" meinst. Sag mir z.B. "bei Trauringstudio" oder "bei Backwerk im Laden rechts", dann kann ich dir die Miete und die Erhöhungslogik genau sagen.',

  noRentData:
    "Für {name} habe ich bisher keine konkreten Mietbeträge gespeichert – nur, dass er Mieter ist. Sag mir z.B. „Er zahlt 1000 € kalt und 200 € Nebenkosten“, dann merke ich mir das.",

  rentStoredIntro:
    "Für {name} habe ich folgende Mieten gespeichert:\n{lines}",

  indexRentNeedIndices:
    "Für {name} ist eine Indexmiete gespeichert. Die Miete darf angepasst werden, wenn der zugrunde liegende Preisindex steigt. Letzte Anpassung: {lastIncrease}. Basisindex: {baseIndex}. Für eine konkrete Berechnung brauche ich den aktuellen Indexwert und den zuletzt verwendeten Index.",

  staffelRentInfo:
    "Für {name} ist ein Staffelmietvertrag hinterlegt. Die Miete steigt zu den im Vertrag vereinbarten Stichtagen automatisch. Ich habe die genauen Staffelbeträge im Moment nicht gespeichert – schau dazu in den Vertrag. Für Staffelmieten brauchst du normalerweise keinen Mietspiegel, weil die Erhöhungen vertraglich festgelegt sind.",

  legalRentNeedMietspiegel:
    "Für {name} ist eine Miete nach Gesetz (keine Staffel, keine Indexmiete) gespeichert. Hier gelten Kappungsgrenze und ortsübliche Vergleichsmiete. Damit ich dir genauer sagen kann, wie viel du erhöhen darfst, brauche ich den Mietspiegel oder vergleichbare Daten für die Stadt.",
} as const;

// 3) Fallbacks / Errors (keine KI-Copy, sondern System-Copy)
export const FALLBACK_COPY_DE = {
  missingApiKey:
    "Mein KI-Gehirn ist noch nicht richtig konfiguriert (kein API-Key hinterlegt).",

  invalidJson:
    "Ich habe deine Nachricht bekommen, aber mein KI-Gehirn hat kein gültiges JSON erzeugt.",

  genericError:
    "Beim Zugriff auf mein KI-Gehirn gab es einen technischen Fehler. Versuch es bitte gleich nochmal.",

  emptyReplyFallback:
    "Ich habe deine Nachricht erhalten, konnte aber keine stabile Antwort generieren.",
} as const;