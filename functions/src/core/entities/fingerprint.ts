// functions/src/core/entities/fingerprint.ts
import crypto from "crypto";

function normalizeUmlauts(s: string) {
  let out = String(s ?? "").normalize("NFKD");

  // diacritics entfernen
  out = out.replace(/[\u0300-\u036f]/g, "");

  // echte deutsche Sonderfälle + Mojibake-Varianten
  out = out
    .replace(/ß/g, "ss")
    .replace(/ÃŸ/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/Ã¤/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/Ã¶/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ã¼/g, "ue");

  // Replacement-Char weg
  out = out.replace(/\uFFFD/g, "");

  return out;
}

function normalizeStreetWords(s: string) {
  const normalizeToken = (tok: string) => {
    if (tok.endsWith("strae")) return tok.slice(0, -5) + "strasse";
    tok = tok.replace(/strae\b/g, "strasse");

    if (tok.endsWith("strasse")) return tok;
    if (tok.endsWith("str")) return tok.slice(0, -3) + "strasse";
    return tok;
  };

  return s
    .split(" ")
    .map((part) =>
      part
        .split(":")
        .map((tok) => normalizeToken(tok))
        .join(":")
    )
    .join(" ");
}

export function normalizeFingerprint(fp: string): string {
  let s = String(fp ?? "").trim().toLowerCase();

  s = normalizeUmlauts(s);
  s = s.replace(/\./g, "");

  // alles raus außer a-z0-9 : _ - . space
  s = s.replace(/[^a-z0-9:_\- ]+/g, "");

  s = s.replace(/\s+/g, " ").trim();
  s = normalizeStreetWords(s);
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

export function mapIdFromFingerprint(fp: string): string {
  const norm = normalizeFingerprint(fp);
  return crypto.createHash("sha256").update(norm).digest("hex");
}