// functions/src/core/satellites/document-understanding/limits/freeProGates.ts

export type UserTier = "free" | "pro";

// Minimaler Gate-Decision-Record (bounded, deterministisch)
export type GateDecision = {
  allowed: boolean;
  reasonCode: string; // short machine-readable
};

// Input ist bewusst klein: keine deep objects, keine dynamischen Sachen
export type GateInput = {
  tier: UserTier;
  // optional: Feature-Flags, falls wir später brauchen
  feature?: "daily_digest_plan";
};

export function gateDailyDigestPlan(input: GateInput): GateDecision {
  // Default: wenn wir nicht wissen, welcher Tier -> fail closed (aber klarer reasonCode)
  const tier = input?.tier;

  if (tier === "pro") {
  return { allowed: true, reasonCode: "tier_pro_allowed" };
}

  if (tier === "free") {
    return { allowed: false, reasonCode: "tier_free_blocked" };
  }

  return { allowed: false, reasonCode: "tier_unknown_blocked" };
}
