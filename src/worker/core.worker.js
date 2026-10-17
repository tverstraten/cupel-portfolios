// The Web Worker the core runs in (OPPORTUNITY-PLAN-APPS.md B1): the screens stay responsive while a book is
// worked out, and a long calculation is stopped by ending the worker. It loads Pyodide and the core from the app's
// own files (public/pyodide, public/core) and answers the calls src/lib/core.js sends.
import { createCore } from "../lib/corehost.js";

// where the app's own files are: given by the screens with the first call (the app's address, whatever it is)
let base = self.location.href;
const at = (p) => new URL(p, base).href;

let core = null;

async function start(payload) {
  if (payload?.base) base = payload.base;
  // the runtime's own loader is one of the app's files; named at run time so the bundler leaves it where it is
  const loader = at("pyodide/pyodide.mjs");
  const { loadPyodide } = await import(/* @vite-ignore */ loader);
  core = await createCore({
    loadPyodide,
    indexURL: at("pyodide/"),
    coreFiles: async () => {
      const list = await (await fetch(at("core/files.json"))).json();
      return Promise.all(list.files.map(async (f) => [f.name, new Uint8Array(await (await fetch(at(`core/cupel_core/${f.name}`))).arrayBuffer())]));
    },
    onProgress: (text) => self.postMessage({ progress: text }),
  });
  return { seconds: core.seconds, ...core.call("version") };
}

self.onmessage = async ({ data }) => {
  const { id, name, payload } = data;
  try {
    let value;
    if (name === "start") value = await start(payload);
    else if (name === "openRelease") value = core.openRelease(payload.manifest, new Map(payload.parts));
    else value = core.call(name, payload);
    self.postMessage({ id, ok: true, value });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e), refused: e?.constructor?.name === "CoreRefused" });
  }
};
