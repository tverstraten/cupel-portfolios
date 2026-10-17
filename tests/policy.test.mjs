// What the app is allowed to do, held in tests (OPPORTUNITY-PLAN-APPS.md B1, B5): it reaches only cupel's API, and
// only for its user's sign-in and the release; the one thing it opens outside itself is cupel's sign-in page; every file of code is in the app; the optimizer and the referral are
// switched off in a release build; the Python runtime it ships is exactly the one the lock file names.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PATHS } from "../src/lib/api.js";
import { APP, ROOT } from "./helpers.mjs";

const API = "http://127.0.0.1:8814";             // src/lib/flags.js's default: the site on this machine, until it is hosted
const SITE = "http://localhost:8814";           // and that site as a browser reaches it, where a person signs in
const conf = JSON.parse(fs.readFileSync(path.join(APP, "src-tauri", "tauri.conf.json"), "utf8"));
const cap = JSON.parse(fs.readFileSync(path.join(APP, "src-tauri", "capabilities", "default.json"), "utf8"));

const build = (outDir, env = {}) => {
  // a build as a release makes it: no flag set, unless the test sets one
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITE_")));
  execFileSync(process.execPath, [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", outDir, "--logLevel", "error"],
               { cwd: APP, env: { ...clean, ...env }, stdio: "pipe" });
  const assets = path.join(APP, outDir, "assets");
  return fs.readdirSync(assets).map((f) => fs.readFileSync(path.join(assets, f), "utf8")).join("\n")
    + fs.readFileSync(path.join(APP, outDir, "index.html"), "utf8");
};

test("the window may read and write its own data folder, ask cupel's API, open cupel's sign-in page, and nothing else", () => {
  const perms = cap.permissions.map((p) => (typeof p === "string" ? p : p.identifier)).sort();
  assert.deepEqual(perms, ["core:default", "fs:allow-appdata-read-recursive", "fs:allow-appdata-write-recursive", "http:default",
                           "opener:allow-open-url"]);
  // the one address it may open in the person's browser: the sign-in page on cupel's own site, and no file or program
  const opener = cap.permissions.find((p) => p.identifier === "opener:allow-open-url");
  assert.deepEqual(opener.allow, [{ url: `${SITE}/app/signin?login=*` }]);
  const flags = fs.readFileSync(path.join(APP, "src", "lib", "flags.js"), "utf8");
  assert.ok(flags.includes(`VITE_CUPEL_SITE || "${SITE}"`) && flags.includes(`VITE_CUPEL_API || "${API}"`));
  assert.ok(!perms.some((p) => /opener:(default|allow-open-path|allow-reveal|allow-default-urls)|shell:/.test(p)));
  const http = cap.permissions.find((p) => p.identifier === "http:default");
  assert.deepEqual(http.allow, [{ url: `${API}/api/v1/*` }]);
  assert.deepEqual(cap.windows, ["main"]);
  // a release carries that one capability and no other: the test variant's (tauri.test.conf.json) is never in it
  assert.deepEqual(conf.app.security.capabilities, ["default"]);
  assert.deepEqual(fs.readdirSync(path.join(APP, "src-tauri", "capabilities")), ["default.json"]);
  assert.equal(conf.identifier, "ca.cupel.app");
  assert.equal(JSON.parse(fs.readFileSync(path.join(APP, "src-tauri", "tauri.test.conf.json"), "utf8")).identifier, "ca.cupel.app.test");
  assert.deepEqual(conf.app.windows.map((w) => w.label), ["main"]);
  const src = fs.readFileSync(path.join(APP, "src-tauri", "src", "main.rs"), "utf8");
  assert.deepEqual([...src.matchAll(/tauri_plugin_(\w+)::init/g)].map((m) => m[1]).sort(), ["fs", "http", "opener"]);
  assert.ok(!/invoke_handler|Command::new|std::process|TcpListener|bind\(/.test(src), "the shell runs no command and opens no port");
});

test("the content security policy lets the screens load only the app's own files and reach only the API", () => {
  const csp = Object.fromEntries(conf.app.security.csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["script-src"], ["'self'", "'wasm-unsafe-eval'"]);          // WebAssembly (Pyodide); no eval, no remote script
  assert.deepEqual(csp["connect-src"].filter((s) => /^https?:/.test(s) && s !== "http://ipc.localhost"), [API]);
  assert.ok(!conf.app.security.csp.includes("'unsafe-eval'") && !/\*/.test(conf.app.security.csp));
});

test("the API paths are the sign-in and the release, and nothing of the user's is in any request", () => {
  assert.deepEqual(Object.keys(PATHS).sort(), ["current", "login", "logout", "part", "take"]);
  const src = fs.readFileSync(path.join(APP, "src", "lib", "api.js"), "utf8");
  // the only body the app ever sends: the secret cupel gave it for this sign-in. No address, no name, no money.
  const bodies = [...src.matchAll(/body: JSON\.stringify\((\{[^}]*\})\)/g)].map((m) => m[1].replace(/\s/g, ""));
  assert.deepEqual(bodies, ["{secret}"]);
  assert.equal([...src.matchAll(/\bbody:/g)].length, 1);
  // the token goes in the Authorization header and nowhere else: never in an address
  assert.ok(!/\$\{[^}]*tok/.test(src.replace(/`Bearer \$\{tok\}`/, "")), "the token is put somewhere other than the header");
  // the only places a request is made: the API client; nothing else in the app calls fetch on an address of its own making
  for (const f of ["App.jsx", "Charts.jsx", "lib/book.js", "lib/release.js", "lib/store.js", "lib/strings.js", "lib/corehost.js", "lib/core.js", "lib/browser.js"]) {
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(fs.readFileSync(path.join(APP, "src", f), "utf8")), `${f} makes a request of its own`);
  }
});

test("a release build holds every file of code itself, and neither the optimizer nor the referral", () => {
  const off = build("dist-policy-off");
  const urls = [...new Set([...off.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)].map((m) => m[0]))].sort();
  const known = [API, SITE, "http://www.w3.org", "https://react.dev", "http://ipc.localhost", "https://tauri.app", "http://tauri.localhost", "https://tauri.localhost"];
  assert.deepEqual(urls.filter((u) => !known.includes(u)), [], "an address in the built files that is not the API's");
  const html = fs.readFileSync(path.join(APP, "dist-policy-off", "index.html"), "utf8");
  assert.ok(![...html.matchAll(/(?:src|href)="([^"]+)"/g)].some((m) => /^(https?:)?\/\//.test(m[1])), "index.html loads something from another site");
  assert.ok(!off.includes("opt-run"), "the optimizer's screen is in a release build");
  assert.ok(!off.includes("opt-found") && !off.includes("opt-builder"), "the optimizer's screen is in a release build");
  // and the check can tell: a build with the switch on does hold it
  const on = build("dist-policy-on", { VITE_CUPEL_OPTIMIZER: "on" });
  assert.ok(on.includes("opt-run") && on.includes("opt-found") && on.includes("opt-builder"));
  for (const d of ["dist-policy-off", "dist-policy-on"]) fs.rmSync(path.join(APP, d), { recursive: true, force: true });
});

test("the Python runtime in the app is the one the lock file names, file for file", () => {
  execFileSync(process.execPath, [path.join(APP, "scripts", "fetch-pyodide.mjs"), "--check"], { cwd: APP, stdio: "pipe" });
  const files = JSON.parse(fs.readFileSync(path.join(APP, "public", "pyodide", "files.json"), "utf8"));
  const here = fs.readdirSync(path.join(APP, "public", "pyodide")).filter((f) => f !== "files.json").sort();
  assert.deepEqual(here, [...files.own, ...files.packages].sort());
  assert.ok(files.packages.some((f) => f.startsWith("numpy-")) && files.packages.some((f) => f.startsWith("scipy-")) && files.packages.some((f) => f.startsWith("pyarrow-")));
});

test("the core in the app is cupel's core, file for file", () => {
  execFileSync(process.execPath, [path.join(APP, "scripts", "bundle-core.mjs")], { cwd: APP, stdio: "pipe" });
  const list = JSON.parse(fs.readFileSync(path.join(APP, "public", "core", "files.json"), "utf8")).files.map((f) => f.name);
  const src = fs.readdirSync(path.join(ROOT, "core", "cupel_core")).filter((f) => f.endsWith(".py")).sort();
  assert.deepEqual(list, src);
  for (const f of src) assert.deepEqual(fs.readFileSync(path.join(APP, "public", "core", "cupel_core", f)), fs.readFileSync(path.join(ROOT, "core", "cupel_core", f)));
});

test("the app opens one thing outside itself: the sign-in link cupel gave it, and only from src/lib/browser.js", () => {
  const files = fs.readdirSync(path.join(APP, "src"), { recursive: true }).map(String).filter((f) => /\.(js|jsx)$/.test(f));
  const opens = files.filter((f) => /openUrl|openPath|plugin-opener|(globalThis|window|self)\.open\(|\bopen\(url|location\.(assign|replace)\(|location\.href\s*=/.test(
    fs.readFileSync(path.join(APP, "src", f), "utf8")));
  assert.deepEqual(opens.map((f) => f.replaceAll("\\", "/")), ["lib/browser.js"]);
  const app = fs.readFileSync(path.join(APP, "src", "App.jsx"), "utf8");
  // what is opened is the address api.login() returned (held to cupel's origin there), never one made up on the way
  assert.deepEqual([...app.matchAll(/openInBrowser\(([^)]*)\)/g)].map((m) => m[1]), ["s.url", "pending.url"]);
  // and the app has no field a person types an address, a password or a token into
  assert.ok(!/type="(email|password)"/.test(app));
});
