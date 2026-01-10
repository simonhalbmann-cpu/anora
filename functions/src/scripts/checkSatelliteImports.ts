// functions/src/scripts/checkSatelliteImports.ts
import fs from "fs";
import path from "path";

const SRC = path.join(process.cwd(), "src");

// Wir prüfen NUR Satelliten-Code
const SAT_ROOT = path.join(SRC, "core", "satellites");

// Erlaubte "pure" Ziele (Allowlist)
const ALLOWED_ABS_PREFIXES = [
  SAT_ROOT, // alles innerhalb core/satellites/**
  path.join(SRC, "core", "utils"), // pure utils
];

// Erlaubte Einzeldateien (pure)
const ALLOWED_ABS_FILES = new Set([
  path.join(SRC, "documentPolicy.ts"),
]);

// Erlaubte Packages (später erweiterbar). Für jetzt: nur Node built-ins.
const ALLOWED_PACKAGES = new Set([
  "fs",
  "path",
  "crypto",
  "url",
  "util",
]);

// Diese Packages sind immer verboten (auch wenn jemand versucht, sie zu benutzen)
const FORBIDDEN_PACKAGES = new Set([
  "firebase-admin",
  "firebase-functions",
  "firebase-functions/v2",
  "firebase-functions/logger",
  "openai",
  "../domains",
  "../../domains",
  "../../../domains",
  "../../../../domains",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function normalize(p: string) {
  return p.replace(/\\/g, "/");
}

function resolveRelativeImport(fromFileAbs: string, spec: string): string | null {
  // spec ist relativ => auflösen
  const baseDir = path.dirname(fromFileAbs);

  const candidates = [
    path.resolve(baseDir, spec),
    path.resolve(baseDir, spec + ".ts"),
    path.resolve(baseDir, spec + ".tsx"),
    path.resolve(baseDir, spec, "index.ts"),
    path.resolve(baseDir, spec, "index.tsx"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function isAllowedAbsTarget(absFile: string): boolean {
  const a = path.resolve(absFile);

  if (ALLOWED_ABS_FILES.has(a)) return true;

  for (const prefix of ALLOWED_ABS_PREFIXES) {
    if (a.startsWith(prefix + path.sep) || a === prefix) return true;
  }
  return false;
}

function extractImportSpecs(ts: string): string[] {
  // simple but effective: match `from "..."` and `import("...")` and require("...")
  const specs: string[] = [];

  const reFrom = /\bfrom\s+["']([^"']+)["']/g;
  const reImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const reRequire = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const re of [reFrom, reImport, reRequire]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(ts))) {
      if (m[1]) specs.push(m[1]);
    }
  }

  return specs;
}

function main() {
  if (!fs.existsSync(SAT_ROOT)) {
    console.log("No satellites folder found, skipping.");
    process.exit(0);
  }

  const files = walk(SAT_ROOT);
  const violations: { file: string; hit: string; reason: string }[] = [];

  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const specs = extractImportSpecs(text);

    for (const spec of specs) {
      // 1) verbotene Packages knallhart blocken
      if (FORBIDDEN_PACKAGES.has(spec)) {
        violations.push({ file: f, hit: spec, reason: "forbidden_package" });
        continue;
      }

      // 2) relative Imports müssen auf erlaubte Ziele zeigen
      if (spec.startsWith(".")) {
        const resolved = resolveRelativeImport(f, spec);
        if (!resolved) {
          violations.push({ file: f, hit: spec, reason: "unresolvable_relative_import" });
          continue;
        }
        if (!isAllowedAbsTarget(resolved)) {
          violations.push({
            file: f,
            hit: `${spec} -> ${normalize(resolved)}`,
            reason: "relative_import_outside_allowlist",
          });
        }
        continue;
      }

      // 3) package imports: nur Allowlist
      if (!ALLOWED_PACKAGES.has(spec)) {
        violations.push({ file: f, hit: spec, reason: "package_not_allowed" });
      }
    }
  }

  if (violations.length) {
    console.error("❌ Satellite import violations found:");
    for (const v of violations) {
      console.error(`- ${normalize(v.file)} -> ${v.hit} (${v.reason})`);
    }
    process.exit(1);
  }

  console.log(`✅ Satellite import check passed (${files.length} files scanned).`);
}

main();