import crypto from "crypto";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v2";
import { mapIdFromFingerprint, normalizeFingerprint } from "./fingerprint";
import type { EntityDoc, EntityDomain, EntityType } from "./types";
import { toEntityDomain, toEntityType } from "./types";

function getDb() {
  return admin.firestore();
}

function entitiesCol(userId: string) {
  return getDb().collection("brain").doc(userId).collection("entities_v1");
}

function mapCol(userId: string) {
  return getDb().collection("brain").doc(userId).collection("entity_map_v1");
}

type EntityMapDoc = {
  mapId: string;
  fingerprint: string; // normalized
  entityId: string;
  domain: EntityDomain;
  type: EntityType;
  createdAt: number;
};

function propertyFingerprintScore(fp: string): number {
  const s = String(fp ?? "");
  if (!s.startsWith("re:property:")) return 0;

  const parts = s.split(":");
  // erwartet: re:property:<city>:<postcode>:<address>
  const city = parts[2] ?? "";
  const postcode = parts[3] ?? "";
  const address = parts.slice(4).join(":") ?? "";

  let score = 0;
  if (city && city !== "unknown_city") score += 1;
  if (postcode && postcode !== "unknown_postcode") score += 2;
  if (address && address !== "unknown_address") score += 2;
  return score;
}

function isWeakPropertyFingerprint(fp: string): boolean {
  return propertyFingerprintScore(fp) <= 1; // praktisch: nur city oder weniger
}

async function tryUpgradeWeakToStrongAlias(opts: {
  tx: FirebaseFirestore.Transaction;
  userId: string;
  domain: EntityDomain;
  type: EntityType;
  fingerprintRaw: string;
  fingerprintNormalized: string;
  mapId: string;
}): Promise<{ entityId: string; created: boolean } | null> {
  const { tx, userId, domain, type, fingerprintRaw, fingerprintNormalized, mapId } = opts;

  // Nur Property-Fingerprints upgraden
  if (domain !== "real_estate" || type !== "property") return null;

  // Erwartet: re:property:<city>:<postcode>:<address...>
  if (!fingerprintNormalized.startsWith("re:property:")) return null;

  const parts = fingerprintNormalized.split(":");
  const city = parts[2] ?? "";
  const postcode = parts[3] ?? "";
  const address = parts.slice(4).join(":") ?? "";

  if (!city || city === "unknown_city") return null;

  // Wenn das neue FP super-weak ist, bringt Upgrade nichts
  if (postcode === "unknown_postcode" && address === "unknown_address") return null;

  const candidateFps: string[] = [];

  if (postcode !== "unknown_postcode" && address !== "unknown_address") {
    candidateFps.push(`re:property:${city}:unknown_postcode:${address}`);
    candidateFps.push(`re:property:${city}:${postcode}:unknown_address`);
  }

  if (address !== "unknown_address") {
    candidateFps.push(`re:property:${city}:unknown_postcode:unknown_address`);
  }

  if (postcode !== "unknown_postcode") {
    candidateFps.push(`re:property:${city}:unknown_postcode:unknown_address`);
  }

  const uniqCandidates = Array.from(new Set(candidateFps));
  if (uniqCandidates.length === 0) return null;

  // WICHTIG: KEINE neue Transaction. Wir benutzen die bestehende tx.
// strongMapRef == mapRef (mapId) und wurde im Caller bereits geprüft.
const strongMapRef = mapCol(userId).doc(mapId);

for (const candFp of uniqCandidates) {


    const candMapId = mapIdFromFingerprint(candFp);
    const candMapRef = mapCol(userId).doc(candMapId);
    const candSnap = await tx.get(candMapRef);

    if (!candSnap.exists) continue;

    const candData = candSnap.data() as EntityMapDoc;

    const aliasDoc: EntityMapDoc = {
      mapId,
      fingerprint: fingerprintNormalized,
      entityId: candData.entityId,
      domain,
      type,
      createdAt: Date.now(),
    };

    tx.set(strongMapRef, aliasDoc, { merge: true });

    logger.info("entityStore_property_upgrade_alias", {
      userId,
      matchedCandidate: candFp,
      strongFpRaw: fingerprintRaw,
      strongFpNormalized: fingerprintNormalized,
      mapId,
      linkedEntityId: candData.entityId,
    });

    return { entityId: candData.entityId, created: false };
  }

  return null;
}

export async function getOrCreateEntityIdByFingerprint(opts: {
  userId: string;
  domain: any;
  type: any;
  fingerprint: string;
  label?: string;
  meta?: Record<string, any>;
}): Promise<{ entityId: string; created: boolean; mapId: string }> {
  const userId = String(opts.userId ?? "").trim();
  if (!userId) throw new Error("userId missing");

  const fingerprintRaw = String(opts.fingerprint ?? "");
  const fingerprint = normalizeFingerprint(fingerprintRaw);

logger.info("entityFingerprint_normalized", {
  userId,
  fingerprintRaw,
  fingerprintNormalized: fingerprint,
});

  if (!fingerprint) throw new Error("fingerprint missing");

  const domain = toEntityDomain(opts.domain);
  const type = toEntityType(opts.type);

  const now = Date.now();
  const mapId = mapIdFromFingerprint(fingerprint);
  const mapRef = mapCol(userId).doc(mapId);

  // Legacy-Compat nur wenn sich wirklich was ändert (sonst doppelter Read auf gleicher Doc-Ref)
// PHASE 1 STRICT: keine Legacy-Compat, keine alternative Normalisierung


  // Transaktion: verhindert Doppel-Erzeugung bei parallelen Calls
  const result = await getDb().runTransaction(async (tx) => {
    
    const mapSnap = await tx.get(mapRef);

    if (mapSnap.exists) {
      const data = mapSnap.data() as EntityMapDoc;
      return { entityId: data.entityId, created: false };
    }

    
// Upgrade: Wenn wir jetzt einen stärkeren Property-Fingerprint haben,
// und ein weak fingerprint für dieselbe Stadt existiert,
// dann mappen wir diesen strong fingerprint als Alias auf das existing entity.
// PHASE 1 STRICT: kein Upgrade/keine Alias-Magie.
// Lieber 2 Entities zu viel als 1 falsche Zusammenlegung.


const entityId = crypto.randomUUID();
    const entityRef = entitiesCol(userId).doc(entityId);

    const entityDoc: EntityDoc = {
  entityId,
  domain,
  type,
  fingerprints: [fingerprint],
  createdAt: now,
  updatedAt: now,

  ...(typeof opts.label === "string" && opts.label.trim()
    ? { label: opts.label.trim() }
    : {}),

  ...(opts.meta && typeof opts.meta === "object"
    ? { meta: opts.meta as Record<string, any> }
    : {}),
};

    const mapDoc: EntityMapDoc = {
      mapId,
      fingerprint,
      entityId,
      domain,
      type,
      createdAt: now,
    };

    tx.set(entityRef, entityDoc, { merge: true });
    tx.set(mapRef, mapDoc, { merge: true });

    return { entityId, created: true };
  });

  logger.info("entityStore_getOrCreate_done", {
    userId,
    mapId,
    domain,
    type,
    created: result.created,
  });

  return { entityId: result.entityId, created: result.created, mapId };
}