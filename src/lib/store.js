// Where the app keeps what is the user's (OPPORTUNITY-PLAN-APPS.md B1): their books and settings, the install
// token, and the release in hand. Files the app owns, in the user's profile folder, through Tauri. Nothing here is
// ever sent anywhere.
//
// One interface, three places: the app (Tauri's file system plugin, under the app's data folder), a browser with no
// Tauri (IndexedDB: the end-to-end tests and `npm run dev`), and memory (the unit tests).
//   readText(path) -> string | null     writeText(path, text)
//   readBytes(path) -> Uint8Array | null  writeBytes(path, bytes)
//   remove(path)   removeDir(path)   list(dir) -> [names]

export function memoryStore(files = new Map()) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  return {
    files,
    async readBytes(p) { return files.has(p) ? files.get(p) : null; },
    async writeBytes(p, b) { files.set(p, new Uint8Array(b)); },
    async readText(p) { return files.has(p) ? dec.decode(files.get(p)) : null; },
    async writeText(p, t) { files.set(p, enc.encode(t)); },
    async remove(p) { files.delete(p); },
    async removeDir(d) { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
    async list(d) { return [...new Set([...files.keys()].filter((k) => k.startsWith(d + "/")).map((k) => k.slice(d.length + 1).split("/")[0]))].sort(); },
  };
}

export function browserStore(name = "cupel") {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const db = new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const run = async (mode, fn) => {
    const d = await db;
    return new Promise((resolve, reject) => {
      const tx = d.transaction("files", mode);
      const req = fn(tx.objectStore("files"));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  const keys = () => run("readonly", (s) => s.getAllKeys());
  return {
    async readBytes(p) { return (await run("readonly", (s) => s.get(p))) ?? null; },
    async writeBytes(p, b) { await run("readwrite", (s) => s.put(new Uint8Array(b), p)); },
    async readText(p) { const b = await this.readBytes(p); return b ? dec.decode(b) : null; },
    async writeText(p, t) { await this.writeBytes(p, enc.encode(t)); },
    async remove(p) { await run("readwrite", (s) => s.delete(p)); },
    async removeDir(d) { for (const k of await keys()) if (String(k).startsWith(d + "/")) await this.remove(k); },
    async list(d) { return [...new Set((await keys()).map(String).filter((k) => k.startsWith(d + "/")).map((k) => k.slice(d.length + 1).split("/")[0]))].sort(); },
  };
}

// The app's own folder, through Tauri's file system plugin: %APPDATA%\<identifier> on Windows,
// ~/Library/Application Support/<identifier> on macOS.
export async function tauriStore() {
  const fs = await import("@tauri-apps/plugin-fs");
  const base = { baseDir: fs.BaseDirectory.AppData };
  const parent = (p) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const ensure = async (dir) => { if (dir) await fs.mkdir(dir, { ...base, recursive: true }); };
  await fs.mkdir("", { ...base, recursive: true }).catch(() => {});
  return {
    async readBytes(p) { return (await fs.exists(p, base)) ? fs.readFile(p, base) : null; },
    async writeBytes(p, b) { await ensure(parent(p)); await fs.writeFile(p, new Uint8Array(b), base); },
    async readText(p) { return (await fs.exists(p, base)) ? fs.readTextFile(p, base) : null; },
    async writeText(p, t) { await ensure(parent(p)); await fs.writeTextFile(p, t, base); },
    async remove(p) { if (await fs.exists(p, base)) await fs.remove(p, base); },
    async removeDir(d) { if (await fs.exists(d, base)) await fs.remove(d, { ...base, recursive: true }); },
    async list(d) { return (await fs.exists(d, base)) ? (await fs.readDir(d, base)).map((e) => e.name).sort() : []; },
  };
}

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openStore() {
  return inTauri() ? tauriStore() : browserStore();
}
