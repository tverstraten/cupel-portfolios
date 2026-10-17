// The Python runtime the app ships (OPPORTUNITY-PLAN-APPS.md B1: "every file of code is in the app"): Pyodide's
// own files from the installed npm package, and the wheels of numpy, scipy, pyarrow and what they need, fetched once
// from Pyodide's release and checked against the SHA-256 its lock file gives. Written to public/pyodide/, which the
// app serves from inside itself and the tests load in Node. Nothing here is loaded at run time from the internet.
//
//   node scripts/fetch-pyodide.mjs          fetch what is missing or does not match
//   node scripts/fetch-pyodide.mjs --check  say whether everything is there and matches; fetch nothing
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(APP, "node_modules", "pyodide");
const OUT = path.join(APP, "public", "pyodide");
export const NEEDS = ["numpy", "scipy", "pyarrow"];
const OWN = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

const lock = JSON.parse(fs.readFileSync(path.join(SRC, "pyodide-lock.json"), "utf8"));
const version = JSON.parse(fs.readFileSync(path.join(SRC, "package.json"), "utf8")).version;
const BASE = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

// every package NEEDS depends on, by the lock's own `depends`
export function closure() {
  const seen = new Map();
  const add = (name) => {
    const p = lock.packages[name] ?? lock.packages[name.toLowerCase()];
    if (!p) throw new Error(`the lock file has no package ${name}`);
    if (seen.has(p.name)) return;
    seen.set(p.name, p);
    for (const d of p.depends ?? []) add(d);
  };
  NEEDS.forEach(add);
  return [...seen.values()];
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function main() {
  const check = process.argv.includes("--check");
  fs.mkdirSync(OUT, { recursive: true });
  let missing = 0, bytes = 0;
  for (const f of OWN) {
    const from = fs.readFileSync(path.join(SRC, f));
    const to = path.join(OUT, f);
    if (!fs.existsSync(to) || sha256(fs.readFileSync(to)) !== sha256(from)) {
      if (check) { missing++; console.log(`missing or changed: ${f}`); continue; }
      fs.writeFileSync(to, from);
    }
    bytes += from.length;
  }
  const pkgs = closure();
  for (const p of pkgs) {
    const to = path.join(OUT, p.file_name);
    if (fs.existsSync(to) && sha256(fs.readFileSync(to)) === p.sha256) { bytes += fs.statSync(to).size; continue; }
    if (check) { missing++; console.log(`missing or changed: ${p.file_name}`); continue; }
    const r = await fetch(BASE + p.file_name);
    if (!r.ok) throw new Error(`${BASE + p.file_name} answered ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (sha256(buf) !== p.sha256) throw new Error(`${p.file_name} does not match the lock file's SHA-256: not kept`);
    fs.writeFileSync(to, buf);
    bytes += buf.length;
    console.log(`fetched ${p.file_name} (${buf.length.toLocaleString()} bytes)`);
  }
  // what the app is allowed to load: the names, for the test that nothing else is asked for
  fs.writeFileSync(path.join(OUT, "files.json"), JSON.stringify({ version, own: OWN, packages: pkgs.map((p) => p.file_name).sort() }, null, 1));
  console.log(`Pyodide ${version}: ${OWN.length} runtime files and ${pkgs.length} packages (${pkgs.map((p) => p.name).sort().join(", ")}), `
    + `${bytes.toLocaleString()} bytes in public/pyodide` + (missing ? `; ${missing} missing or changed` : ""));
  if (check && missing) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
