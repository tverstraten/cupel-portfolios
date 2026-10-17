// The test variant of the program, built and set aside as src-tauri/target/cupel-test.exe, for
// tests/e2e/exe.e2e.mjs. It is the same shell and the same screens as the release, with the test configuration merged
// in (its own data folder, the stand-in API). The release program (target/release/cupel.exe) is built again after
// by `npm run build:exe`: both come out of the same folder, one at a time.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauri = path.join(APP, "node_modules", "@tauri-apps", "cli", "tauri.js");
execFileSync(process.execPath, [tauri, "build", "--no-bundle", "--config", "src-tauri/tauri.test.conf.json"], { cwd: APP, stdio: "inherit" });
const from = path.join(APP, "src-tauri", "target", "release", "cupel.exe");
const to = path.join(APP, "src-tauri", "target", "cupel-test.exe");
fs.copyFileSync(from, to);
console.log(`the test variant: ${to} (${fs.statSync(to).size.toLocaleString()} bytes)`);
