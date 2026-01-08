// functions/src/core/entities/resolver.ts
/**
 * Core contract:
 * - Core kennt KEINE Indexing-Implementierung
 * - Resolver kann von außen injected werden (indexing, legacy, tests)
 */
export type EntityResolverV1 = {
  getOrCreateEntityIdByFingerprint: (params: {
    userId: string;
    entityDomain: string;
    fingerprintRaw: string;
  }) => Promise<{ entityId: string } | null>;
};