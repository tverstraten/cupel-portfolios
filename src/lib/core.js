// The screens' side of the core: calls sent to the worker (src/worker/core.worker.js), each answered once.
// `stop()` ends the worker in the middle of whatever it is doing (a long optimization) and starts a fresh one,
// which is given the release in hand again before the next call.
export class CoreRefused extends Error {}

export function startCore(onProgress = () => {}) {
  let worker, ready, pending, next = 0, release = null;
  const boot = () => {
    pending = new Map();
    worker = new Worker(new URL("../worker/core.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) return onProgress(data.progress);
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.ok) p.resolve(data.value);
      else p.reject(data.refused ? new CoreRefused(data.error) : new Error(data.error));
    };
    worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || "the calculator stopped")); pending.clear(); };
    // the app's own address: where the worker finds the runtime and the core (public/pyodide, public/core)
    ready = send("start", { base: new URL(import.meta.env.BASE_URL, document.baseURI).href }).then(async (v) => { if (release) await send("openRelease", release); return v; });
    return ready;
  };
  const send = (name, payload) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, name, payload });
  });
  boot();
  return {
    started: () => ready,
    async call(name, payload = {}) { await ready; return send(name, payload); },
    // parts: Map(name -> Uint8Array); kept so a restarted worker opens the same release
    async openRelease(manifest, parts) {
      await ready;
      const payload = { manifest, parts: [...parts] };
      const out = await send("openRelease", payload);
      release = payload;
      return out;
    },
    stop() {
      worker.terminate();
      for (const p of pending.values()) p.reject(new Error("stopped"));
      return boot();
    },
  };
}
