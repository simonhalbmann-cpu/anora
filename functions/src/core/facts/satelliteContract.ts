// --------------------------------------------------
// SATELLITE CONTRACT — verbindlich für ALLE Satelliten
// --------------------------------------------------
//
// Ein Satellite DARF:
// - Facts erzeugen (write)
// - Meta-Informationen setzen
//
// Ein Satellite DARF NICHT:
// - Gewinner bestimmen
// - Konflikte auflösen
// - isSuperseded setzen
// - andere Facts verändern
//
// Der Resolver ist die EINZIGE Instanz,
// die Entscheidungen trifft.
//
// --------------------------------------------------

export type SatelliteFactContract = {
  // Identität
  entityId: string;        // MUSS gesetzt sein
  key: string;             // MUSS gesetzt sein (z.B. "rent:cold")

  // Inhalt
  value: any;              // strukturierter Wert

  // Provenance / Herkunft
  meta: {
    extractorId: string;   // z.B. "real_estate.v1"
    satelliteId: string;   // z.B. "document-understanding.v1"

    // Quelle (kleine, feste Liste)
    sourceType:
      | "user"
      | "contract"
      | "official_document"
      | "email"
      | "expose"
      | "derived"
      | "other";

    // Finalitätsstufe (keine Logik!)
    finality?: "draft" | "interim" | "final";

    // Zeitliche Einordnung
    temporal?: "current" | "amended" | "historical" | "unknown";

    // Einschätzungen (0..1)
    confidence?: number;
    sourceReliability?: number;

    // Flags (nur Information!)
    latest?: boolean;
    system?: boolean;
    userConfirmed?: boolean;

    // Referenzen (optional, aber empfohlen)
    docId?: string;
    rawEventId?: string;
  };
};