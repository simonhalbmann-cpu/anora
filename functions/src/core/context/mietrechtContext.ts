// functions/src/core/context/mietrechtContext.ts

import admin from "firebase-admin";
import { logger } from "firebase-functions/v2";

function getDb() {
  // defensiv: falls diese Datei jemals ohne src/index.ts importiert wird
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

// ---- Meta helpers (minimal, analog zum God-File) ----
async function setMetaContext(
  userId: string,
  key: string,
  doc: Record<string, any>
): Promise<void> {
  const db = getDb(); // <-- WICHTIG: hier, nicht top-level
  const ref = db.collection("brain").doc(userId).collection("meta").doc(key);
  await ref.set(doc, { merge: true });
}

export type MietrechtContext = {
  lastCity?: string;
  lastPostal?: string;
  hasMietspiegel?: boolean;
  mietspiegelSource?: string;
};

export async function setMietrechtContextForUser(
  userId: string,
  ctx: MietrechtContext
): Promise<void> {
  // wir verwenden weiter das Dokument "cityContext" als Speicherort
  await setMetaContext(userId, "cityContext", ctx);
}

export async function updateMietrechtContextFromFacts(
  userId: string,
  facts: { type?: string; data?: any }[],
  options?: { filename?: string | null; source?: string | null }
): Promise<void> {
  if (!facts || facts.length === 0) {
    // kann trotzdem sinnvoll sein, wenn nur Mietspiegel-Datei erkannt wird
  }

  let lastCity: string | undefined;
  let lastPostal: string | undefined;

  for (const fact of facts) {
    if (!fact || typeof fact !== "object") continue;
    if (fact.type !== "property" && fact.type !== "tenant") continue;

    const d: any = (fact as any).data ?? {};

    if (!lastCity && typeof d.city === "string" && d.city.trim()) {
      lastCity = d.city.trim();
    }

    if (!lastPostal) {
      const postal =
        (typeof d.zipCode === "string" && d.zipCode.trim()) ||
        (typeof d.postal === "string" && d.postal.trim()) ||
        (typeof d.plz === "string" && d.plz.trim());
      if (postal) lastPostal = postal;
    }
  }

  let hasMietspiegel: boolean | undefined;
  let mietspiegelSource: string | undefined;

  const filename = options?.filename ?? undefined;
  const source = options?.source ?? undefined;
  const nameForDetection = (filename || source || "").toLowerCase();

  if (nameForDetection.includes("mietspiegel")) {
    hasMietspiegel = true;
    mietspiegelSource = filename || source;
  }

  if (!lastCity && !lastPostal && hasMietspiegel === undefined) return;

  const payload: MietrechtContext = {};
  if (lastCity) payload.lastCity = lastCity;
  if (lastPostal) payload.lastPostal = lastPostal;
  if (hasMietspiegel !== undefined) payload.hasMietspiegel = hasMietspiegel;
  if (mietspiegelSource) payload.mietspiegelSource = mietspiegelSource;

  try {
    await setMietrechtContextForUser(userId, payload as any);
    logger.info("mietrechtContext_updated_from_facts", {
      userId,
      lastCity,
      lastPostal,
      hasMietspiegel,
      mietspiegelSource,
    });
  } catch (err) {
    logger.error("mietrechtContext_update_failed", {
      userId,
      error: String(err),
    });
  }
}