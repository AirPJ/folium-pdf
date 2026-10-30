// After a signed build: gives the installer a web-friendly name and writes
// latest.json, the file the in-app updater reads.
// Usage: node scripts/ci-update-manifest.mjs <version> <release download base URL> <out dir>
import { readdirSync, readFileSync, renameSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const [version, baseUrl, outDir] = process.argv.slice(2);
if (!version || !baseUrl || !outDir) throw new Error("usage: <version> <baseUrl> <outDir>");

const dir = "src-tauri/target/release/bundle/nsis";
const exe = readdirSync(dir).find((f) => f.endsWith("-setup.exe"));
if (!exe) throw new Error("installer not found");
const sigFile = join(dir, `${exe}.sig`);
const signature = readFileSync(sigFile, "utf8").trim();

const name = `Folium-PDF_${version}_x64-setup.exe`;
mkdirSync(outDir, { recursive: true });
copyFileSync(join(dir, exe), join(outDir, name));
copyFileSync(sigFile, join(outDir, `${name}.sig`));

// The commit message, without the lines meant for git tools.
const notes = (process.env.RELEASE_NOTES ?? "")
  .split("\n")
  .filter((l) => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l.trim()))
  .join("\n")
  .trim() || "Improvements and fixes.";
writeFileSync("release-notes.md", notes + "\n");
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": { signature, url: `${baseUrl}/${name}` },
  },
};
writeFileSync(join(outDir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote latest.json for ${version} → ${name}`);
