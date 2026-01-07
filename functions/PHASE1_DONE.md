# PHASE 1 DONE (Core Freeze + latest-only + determinism)

## Proofs (all green)
- npm run build
- npm run test:phase11
  - Golden ✅
  - CORE FREEZE NEG ✅
  - IDEMPOTENZ ✅
  - REAL CHANGE ✅
  - LATEST ✅
- node lib/scripts/runCoreContractTest_A5_2.js ✅
- node lib/scripts/runDeterminismTest_Phase1.js ✅

## Contracts achieved
- Core facts are frozen keys/domains/extractors (CORE_FREEZE)
- latest-only factIds stable (entityId + key + "__latest__" + validity)
- strict reject for:
  - domain not frozen
  - extractorId not frozen (raw_event)
  - normalized key changes for non-system facts
- satellites OFF => no fact writes planned
- runCoreOnce deterministic (timestamp=0, stable hashing)