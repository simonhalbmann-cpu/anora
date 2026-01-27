// functions/src/core/facts/factId.ts
// Roadmap 3.2: deterministische FactId

import { sha256Hex } from "../utils/hash";
import { stableStringify } from "../utils/stableStringify";
import type { FactKey, FactValue, ValidityWindow } from "./types";

type Options = {
  validityWindow?: ValidityWindow;

  // 🔧 MINIMAL FIX: Domain in FactId erzwingen (verhindert latest-Kollisionen)
  domain?: string;
};

export function buildFactId(params: {
  entityId: string;
  domain: string;          // << NEU: domain muss rein
  key: FactKey;
  value: FactValue;
  options?: Options;
}): string {
  const { entityId, domain, key, value, options } = params;

  const normalizedValue = stableStringify(value);

  const validity = options?.validityWindow ?? {};
  const validityNorm = stableStringify({
    from: typeof validity.from === "number" ? validity.from : null,
    to: typeof validity.to === "number" ? validity.to : null,
  });

  // contract: entityId + domain + key + value + validity
  const material = `${entityId}::${domain}::${key}::${normalizedValue}::${validityNorm}`;

  return sha256Hex(material);
}