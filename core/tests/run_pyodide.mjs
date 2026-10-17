// The core's tests under Pyodide, in Node (OPPORTUNITY-PLAN-APPS.md A2: "the core's tests under CPython and under
// Pyodide (in Node, which runs the same WebAssembly)"). It loads the very runtime files the app ships
// (app/public/pyodide, fetched by app/scripts/fetch-pyodide.mjs), puts the core and its tests into Pyodide's
// file system, and calls every test_ function of test_core.py: the tests pytest runs under CPython, held to the
// same expected figures. Exits 1 when any fails.
//
//   node core/tests/run_pyodide.mjs [name-part ...]     only the tests whose name holds one of the parts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, "..");
const APP = path.resolve(CORE, "..");
const RUNTIME = path.join(APP, "public", "pyodide");
if (!fs.existsSync(path.join(RUNTIME, "pyodide.asm.wasm"))) {
  console.error("the Python runtime is not in public/pyodide: run `npm run runtime` in the repo root");
  process.exit(2);
}

export async function startPyodide() {
  const { loadPyodide } = await import(pathToFileURL(path.join(APP, "node_modules", "pyodide", "pyodide.mjs")).href);
  const t0 = Date.now();
  const py = await loadPyodide({ indexURL: RUNTIME + path.sep, stdout: () => {}, stderr: () => {} });
  await py.loadPackage(["numpy", "scipy", "pyarrow"], { messageCallback: () => {}, errorCallback: (m) => console.error(m) });
  return { py, seconds: (Date.now() - t0) / 1000 };
}

// a directory of the repository copied into Pyodide's file system
export function copyIn(py, from, to) {
  py.FS.mkdirTree(to);
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === "__pycache__" || e.name.endsWith(".mjs")) continue;
    const a = path.join(from, e.name), b = `${to}/${e.name}`;
    if (e.isDirectory()) copyIn(py, a, b);
    else py.FS.writeFile(b, fs.readFileSync(a));
  }
}

async function main() {
  const only = process.argv.slice(2);
  const { py, seconds } = await startPyodide();
  copyIn(py, path.join(CORE, "cupel_core"), "/core/cupel_core");
  copyIn(py, HERE, "/core/tests");
  py.globals.set("ONLY", py.toPy(only));
  const out = await py.runPythonAsync(`
import sys, time, traceback, json
sys.path[:0] = ["/core", "/core/tests"]
import numpy, scipy, pyarrow
import test_core
results = []
for name in sorted(n for n in dir(test_core) if n.startswith("test_")):
    if ONLY and not any(part in name for part in ONLY):
        continue
    t = time.time()
    try:
        getattr(test_core, name)()
        results.append((name, True, time.time() - t, ""))
    except BaseException:
        results.append((name, False, time.time() - t, traceback.format_exc()))
json.dumps({"python": sys.version.split()[0], "numpy": numpy.__version__, "scipy": scipy.__version__,
            "pyarrow": pyarrow.__version__, "results": results})
`);
  const r = JSON.parse(out);
  console.log(`Pyodide: Python ${r.python}, numpy ${r.numpy}, scipy ${r.scipy}, pyarrow ${r.pyarrow}; loaded in ${seconds.toFixed(1)}s`);
  let failed = 0;
  for (const [name, ok, secs, said] of r.results) {
    console.log(`${ok ? "ok    " : "FAILED"} ${name} (${secs.toFixed(1)}s)`);
    if (!ok) { failed++; console.log(said.split("\n").map((l) => "       " + l).join("\n")); }
  }
  console.log(`${r.results.length - failed} passed, ${failed} failed, under Pyodide`);
  process.exit(failed || !r.results.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
