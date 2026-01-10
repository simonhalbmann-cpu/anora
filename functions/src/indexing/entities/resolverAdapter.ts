// functions/src/indexing/entities/resolverAdapter.ts
import type { EntityResolverV1 } from "../../core/entities/resolver";
import { getOrCreateEntityIdByFingerprint } from "./store";

export const indexingEntityResolverV1: EntityResolverV1 = {
  getOrCreateEntityIdByFingerprint: async ({
    userId,
    entityDomain,
    fingerprintRaw,
  }) => {
    return getOrCreateEntityIdByFingerprint({
      userId,
      domain: entityDomain,
      type: "generic",
      fingerprint: fingerprintRaw,
    });
  },
};