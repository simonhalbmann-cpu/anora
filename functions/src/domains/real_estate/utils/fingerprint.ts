// functions/src/domains/real_estate/utils/fingerprint.ts

function cleanPart(x: any): string {
  return String(x ?? "").trim();
}

export function buildPropertyFingerprintV1(input: {
  city?: string;
  postcode?: string;
  street?: string;
  houseNumber?: string;
}): string {
  const city = cleanPart(input.city).toLowerCase();
  const postcode = cleanPart(input.postcode);
  const street = cleanPart(input.street).toLowerCase();
  const houseNumber = cleanPart(input.houseNumber).toLowerCase();

  // minimal: wir erlauben auch ohne PLZ, aber dann ist es schwächer
  // (und kann eher kollidieren)
  const parts = [
    "re:property",
    city || "unknown_city",
    postcode || "unknown_postcode",
    [street, houseNumber].filter(Boolean).join(" ").trim() || "unknown_address",
  ];

  return parts.join(":");
}