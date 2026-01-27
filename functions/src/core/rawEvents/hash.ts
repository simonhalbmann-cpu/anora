// functions/src/core/rawEvents/hash.ts

import crypto from "crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function dayBucketUTC(ts: number): string {
  // stabil und einfach: UTC Tag
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function dayBucketInTimeZone(ts: number, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // en-CA => YYYY-MM-DD
    return fmt.format(new Date(ts));
  } catch {
    // Fallback: UTC, falls Timezone ungültig
    return dayBucketUTC(ts);
  }
}