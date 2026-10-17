// The core's Python files put where the app serves them from inside itself (public/core/), with their names and
// SHA-256: the app's worker reads that list and loads exactly those files into Pyodide. Run before a build and
// before the tests; the files are copies, made again each time, never edited there.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(APP, "core", "cupel_core");
const OUT = path.join(APP, "public", "core");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "cupel_core"), { recursive: true });
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".py")).sort().map((name) => {
  const bytes = fs.readFileSync(path.join(SRC, name));
  fs.writeFileSync(path.join(OUT, "cupel_core", name), bytes);
  return { name, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
});
fs.writeFileSync(path.join(OUT, "files.json"), JSON.stringify({ files }, null, 1));
console.log(`the core: ${files.length} files, ${files.reduce((t, f) => t + f.bytes, 0).toLocaleString()} bytes in public/core`);
