import crypto from "crypto";
import * as admin from "firebase-admin";
import { mapIdFromFingerprint, normalizeFingerprint } from "../../core/entities/fingerprint";
import type { EntityDoc, EntityDomain, EntityType } from "../../core/entities/types";
import { toEntityDomain, toEntityType } from "../../core/entities/types";
import { logger } from "../../core/logging/logger";

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