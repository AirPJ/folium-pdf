// Sets the version of a GitHub build to MAJOR.MINOR.<run number>, taking
// MAJOR.MINOR from package.json. Every build gets a higher number, which is
// how the in-app updater knows a build is newer than the installed one.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const run = process.env.GITHUB_RUN_NUMBER;
if (!run) throw new Error("GITHUB_RUN_NUMBER is not set");
const [major, minor] = JSON.parse(readFileSync("package.json", "utf8")).version.split(".");
const version = `${major}.${minor}.${run}`;

const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Version ${version}`);
