// Lists every string passed to t() / tn() in src, and checks a locale for
// missing or unused entries.  Usage: node scripts/i18n-keys.mjs [fr]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== "locales") walk(p); }
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
})("src");

const keys = new Set();
const str = String.raw`"((?:[^"\\]|\\.)*)"`;
const reT = new RegExp(String.raw`\bt\(\s*` + str, "g");
const reTn = new RegExp(String.raw`\btn\([^,]+,\s*` + str + String.raw`\s*,\s*` + str, "g");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(reT)) keys.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(reTn)) { keys.add(JSON.parse(`"${m[1]}"`)); keys.add(JSON.parse(`"${m[2]}"`)); }
}

const lang = process.argv[2];
if (!lang) { console.log(JSON.stringify([...keys].sort(), null, 1)); process.exit(0); }
const text = readFileSync(`src/locales/${lang}.ts`, "utf8");
const have = new Set(
  [...text.matchAll(/^\s*(?:("(?:[^"\\]|\\.)*")|([A-Za-z_$][\w$]*))\s*:/gm)].map((m) => (m[1] ? JSON.parse(m[1]) : m[2])),
);
const missing = [...keys].filter((k) => !have.has(k));
const unused = [...have].filter((k) => !keys.has(k));
console.log(`${keys.size} strings, ${missing.length} missing, ${unused.length} unused in ${lang}`);
missing.forEach((k) => console.log("  missing:", JSON.stringify(k)));
unused.forEach((k) => console.log("  unused: ", JSON.stringify(k)));
process.exit(missing.length ? 1 : 0);
