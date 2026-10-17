// The core, run by Pyodide: the one place the app's JavaScript meets the Python that computes a book
// (OPPORTUNITY-PLAN-APPS.md B1). It is given how to load Pyodide and where the runtime and the core's files are, so
// the same code runs in the app's Web Worker (src/worker/core.worker.js) and in Node (the tests): what the tests
// exercise is what the app runs.
//
// Everything that crosses is JSON: a call's name and its payload in, {ok, value} or {ok: false, error} out. A
// release's parts are written into Pyodide's own file system, where the core reads and checks them.

export const PACKAGES = ["numpy", "scipy", "pyarrow"];

const BOOT = `
import json, math, sys
sys.path.insert(0, "/core")
import numpy, scipy, pyarrow
from cupel_core import __version__ as CORE_VERSION
from cupel_core.api import BUILDERS, Session, account_types
from cupel_core.settings import CoreError

_session = Session()
_progress = None


def _say(text, **_):
    if _progress is not None:
        _progress(str(text))


def _clean(x):
    # JSON has no NaN: a figure that is not a number crosses as null
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x


def _open(a):
    return _session.open(a["manifest"], lambda part: open("/release/" + a["dir"] + "/" + part, "rb").read())


CALLS = {
    "version": lambda a: {"core": CORE_VERSION, "python": sys.version.split()[0], "numpy": numpy.__version__,
                          "scipy": scipy.__version__, "pyarrow": pyarrow.__version__},
    "open": _open,
    "catalogue": lambda a: _session.catalogue(),
    "account_types": lambda a: account_types(a["country"]),
    "builders": lambda a: BUILDERS,
    "pools": lambda a: _session.pools(a["book"]),
    "evaluate": lambda a: _session.evaluate(a["book"], detail=a.get("detail", True)),
    "optimize": lambda a: _session.optimize(a["book"], a["builder"], a["runs"], starts=a.get("starts", 3),
                                            max_dd=a.get("max_dd"), say=_say),
    "self_check": lambda a: _session.self_check(a["cases"]),
}


def call(name, payload):
    try:
        return json.dumps({"ok": True, "value": _clean(CALLS[name](json.loads(payload)))})
    except CoreError as e:
        return json.dumps({"ok": False, "error": str(e)})
`;

// `loadPyodide`: Pyodide's own; `indexURL`: where its files and the packages are; `coreFiles`: async () => [[name,
// Uint8Array]] of cupel_core's files; `onProgress`: what the core says while it works (the optimizer's starts).
export async function createCore({ loadPyodide, indexURL, coreFiles, onProgress = () => {} }) {
  const t0 = Date.now();
  const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
  await py.loadPackage(PACKAGES, { messageCallback: () => {}, errorCallback: () => {} });
  py.FS.mkdirTree("/core/cupel_core");
  for (const [name, bytes] of await coreFiles()) py.FS.writeFile(`/core/cupel_core/${name}`, bytes);
  py.runPython(BOOT);
  py.globals.set("_progress", (text) => onProgress(text));
  const pyCall = py.globals.get("call");
  const call = (name, payload = {}) => {
    const out = JSON.parse(pyCall(name, JSON.stringify(payload)));
    if (!out.ok) throw new CoreRefused(out.error);
    return out.value;
  };
  let opened = 0;
  return {
    seconds: (Date.now() - t0) / 1000,
    call,
    // `parts`: Map or object of part name -> Uint8Array. The core checks each against the manifest before it reads
    // one; a release that fails is refused and the one in hand stays.
    openRelease(manifest, parts) {
      const dir = `r${++opened}`;
      for (const [name, bytes] of parts instanceof Map ? parts : Object.entries(parts)) {
        const at = `/release/${dir}/${name}`;
        py.FS.mkdirTree(at.slice(0, at.lastIndexOf("/")));
        py.FS.writeFile(at, bytes);
      }
      return call("open", { manifest, dir });
    },
  };
}

// what the core refused, in its own words (a rule of the accounts, a run that is not in the release, a bad part)
export class CoreRefused extends Error {}
