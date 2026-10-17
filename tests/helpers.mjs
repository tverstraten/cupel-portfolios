// What the app's tests share: the small test release (core/tests/release, the same files the core's tests read),
// a stand-in for cupel's API that serves it, and the core started on the runtime the app ships.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(APP, "..");
export const FIXTURE = path.join(ROOT, "core", "tests", "release");
export const EXPECTED = JSON.parse(fs.readFileSync(path.join(ROOT, "core", "tests", "expected.json"), "utf8"));

export function fixture() {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, "manifest.json"), "utf8"));
  const parts = new Map(manifest.parts.map((p) => [p.part, new Uint8Array(fs.readFileSync(path.join(FIXTURE, p.part)))]));
  return { manifest, parts };
}

// cupel's API as a function: {current(), part(id, part)} with what was asked recorded, and ways to make it fail
export function fakeApi({ manifest, parts }) {
  const asked = [];
  return {
    asked,
    failAfter: Infinity,                 // parts served before every later one fails (an interrupted download)
    corrupt: null,                       // a part served with one byte changed
    offline: false,
    async current() {
      if (this.offline) throw Object.assign(new Error("cupel could not be reached"), { status: 0 });
      asked.push("current");
      return structuredClone(manifest);
    },
    async part(id, part) {
      if (this.offline) throw Object.assign(new Error("cupel could not be reached"), { status: 0 });
      if (asked.filter((a) => a.startsWith("part:")).length >= this.failAfter) throw Object.assign(new Error("the connection was lost"), { status: 0 });
      asked.push(`part:${part}`);
      const bytes = new Uint8Array(parts.get(part));
      if (this.corrupt === part) bytes[100] ^= 1;
      return bytes;
    },
  };
}

// the core, on the Python runtime the app ships and the core files the app bundles
export async function startCore(onProgress) {
  const { createCore } = await import(pathToFileURL(path.join(APP, "src", "lib", "corehost.js")).href);
  const { loadPyodide } = await import(pathToFileURL(path.join(APP, "node_modules", "pyodide", "pyodide.mjs")).href);
  const list = JSON.parse(fs.readFileSync(path.join(APP, "public", "core", "files.json"), "utf8"));
  return createCore({
    loadPyodide,
    indexURL: path.join(APP, "public", "pyodide") + path.sep,
    coreFiles: async () => list.files.map((f) => [f.name, new Uint8Array(fs.readFileSync(path.join(APP, "public", "core", "cupel_core", f.name)))]),
    onProgress,
  });
}

// cupel's API as a server on 127.0.0.1 (the end-to-end tests): the app's sign-in, the release for a signed-in app,
// and a record of every request made to it (with whether it carried a token, never the token). CORS is open, as a
// browser page on another port needs. The person's part of a sign-in (signing in to cupel in their browser and
// approving) is `approve()`: until it is called the app's sign-in is pending, as on cupel.
export async function apiServer({ manifest, parts }, port = 0) {
  const requests = [], logins = [], tokens = new Set();
  const state = { down: false, corrupt: null };
  let url;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let body = "";
    for await (const c of req) body += c;
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    requests.push({ method: req.method, path: u.pathname + u.search, body, token: token != null, origin: req.headers.origin ?? null });
    const json = (code, o) => res.writeHead(code, { ...cors, "content-type": "application/json" }).end(JSON.stringify(o));
    if (state.down) return req.socket.destroy();
    // the page the app opens in the person's browser: cupel's own, stood in for by one line
    if (u.pathname === "/app/signin") return res.writeHead(200, { "content-type": "text/html" }).end("<title>cupel sign-in (stand-in)</title>");
    if (u.pathname === "/api/v1/app/login" && req.method === "POST") {
      const n = logins.length + 1;
      const l = { login_id: `${n}`.padStart(32, "0"), secret: `secret-${n}-${"s".repeat(40)}`, check: `C0DE${n % 100}`.padEnd(6, "0"),
                  approved: null, taken: false };
      logins.push(l);
      return json(201, { login_id: l.login_id, secret: l.secret, check: l.check, expires_in: 600, url: `${url}/app/signin?login=${l.login_id}` });
    }
    if (u.pathname === "/api/v1/app/login/take" && req.method === "POST") {
      const l = logins.find((x) => x.secret === JSON.parse(body || "{}").secret);
      if (!l || l.taken) return json(401, { error: "that sign-in has expired: start again" });
      if (!l.approved) return json(202, { pending: true });
      l.taken = true;
      const install_token = `install-token-${logins.indexOf(l) + 1}`;
      tokens.add(install_token);
      return json(200, { install_token, ...l.approved });
    }
    if (u.pathname === "/api/v1/app/logout" && req.method === "POST") return json(200, { signed_out: tokens.delete(token) });
    if (u.pathname.startsWith("/api/v1/releases/")) {
      if (!tokens.has(token)) return json(401, { error: "sign in: this needs a signed-in app's token" });
      if (u.pathname === "/api/v1/releases/current") return json(200, manifest);
      const m = u.pathname.match(/^\/api\/v1\/releases\/(\d+)\/parts\/(.+)$/);
      if (m) {
        const part = decodeURIComponent(m[2]);
        if (!parts.has(part) || Number(m[1]) !== manifest.release_id) return json(404, { error: `release ${m[1]} has no part ${part}` });
        const bytes = Buffer.from(parts.get(part));
        if (state.corrupt === part) bytes[100] ^= 1;
        return res.writeHead(200, { ...cors, "content-type": "application/octet-stream" }).end(bytes);
      }
    }
    json(404, { error: "no such address" });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, requests, logins, tokens, state,
    // the person signs in to cupel in their browser and approves the newest sign-in an app started
    approve(who = { email: "someone@example.com", country: "CA", region: "Ontario" }) {
      const l = logins.findLast((x) => !x.approved);
      assert.ok(l, "no sign-in is waiting to be approved");
      l.approved = who;
      return l;
    },
    revoke() { tokens.clear(); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
