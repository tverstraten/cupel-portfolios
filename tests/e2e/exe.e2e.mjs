// The program itself (OPPORTUNITY-PLAN-APPS.md B1's checks, B2-B5, B8; sign-in and the data fetched by the app
// itself, Todd 2026-10-05): the test variant of the compiled app (src-tauri/target/cupel-test.exe,
// `npm run build:test-exe`) is started, its real window is driven through WebView2's debugging port, and what it
// does on this machine is checked: its files in its own data folder, its requests (through Tauri, to the stand-in
// API on 127.0.0.1:18814), its figures, and that closing it leaves no process behind.
//
// The test variant has its own data folder (ca.cupel.app.test), emptied before and after: a real user's app and
// data are never touched. It does not open a browser on this machine (VITE_CUPEL_BROWSER=off: the sign-in link is
// shown, and the test plays the person who opens it and approves). Skipped, saying why, when the test variant has
// not been built.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { APP, EXPECTED, apiServer, fixture } from "../helpers.mjs";

const EXE = path.join(APP, "src-tauri", "target", "cupel-test.exe");
const built = fs.existsSync(EXE) && process.platform === "win32";
const skip = built ? false : "the test variant of the program is not built: npm run build:test-exe (Windows)";
const DATA = path.join(process.env.APPDATA ?? "", "ca.cupel.app.test");
const WEBVIEW = path.join(process.env.LOCALAPPDATA ?? "", "ca.cupel.app.test");
const PORT = 18814, DEBUG = 9334;
const BOOK = EXPECTED.self_check[0].book;
const id = (x) => `[data-testid="${x}"]`;
const apiPaths = (from = 0) => api.requests.slice(from).map((r) => `${r.method} ${r.path}`);

let api, child, browser, page;

const running = () => execFileSync("tasklist", ["/FI", "IMAGENAME eq cupel-test.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" })
  .split(/\r?\n/).filter((l) => l.startsWith('"cupel-test.exe"')).length;

async function start() {
  child = spawn(EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG}` }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG}`); break; } catch { /* not up yet */ }
  }
  assert.ok(browser, "the program's window never appeared");
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector(`${id("core-status")}[data-status="ready"]`, { timeout: 120000 });
}

// closed as a person closes it (the window's close button), then: gone, with nothing left running
async function close() {
  await browser?.close().catch(() => {});
  browser = null;
  const gone = new Promise((r) => child.once("exit", r));
  execFileSync("taskkill", ["/PID", String(child.pid)], { stdio: "ignore" });       // no /F: asks the window to close
  await Promise.race([gone, new Promise((r) => setTimeout(r, 15000))]);
  for (let i = 0; i < 20 && running(); i++) await new Promise((r) => setTimeout(r, 250));
  return running();
}

const fetched = (status = "current") => page.waitForSelector(`${id("data-line")}[data-status="${status}"]`, { timeout: 180000 });

before(async () => {
  if (skip) return;
  assert.equal(running(), 0, "a test variant of the program is already running");
  for (const d of [DATA, WEBVIEW]) fs.rmSync(d, { recursive: true, force: true });
  api = await apiServer(fixture(), PORT);
});

after(async () => {
  if (skip) return;
  if (child && child.exitCode === null) { await browser?.close().catch(() => {}); child.kill(); }
  await api.close();
  await new Promise((r) => setTimeout(r, 1500));
  for (const d of [DATA, WEBVIEW]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test("the program starts, opens its window, its calculator runs inside it, and it shows only Sign in", { skip }, async () => {
  await start();
  assert.equal(running(), 1);
  assert.equal(await page.evaluate(() => "__TAURI_INTERNALS__" in window), true);
  assert.match(await page.evaluate(() => location.origin), /tauri\.localhost|^tauri:/);          // its own files, no server
  assert.match(await page.textContent(id("core-status")), /The calculator is ready/);
  assert.equal(api.requests.length, 0, "the program asked the API for something before anyone signed in");
  assert.equal(await page.evaluate(() => document.querySelectorAll("script[src^='http']").length), 0);
  assert.equal(await page.locator(id("signin-start")).count(), 1);
  assert.equal(await page.locator(id("tab-book")).count(), 0);
  assert.ok(!fs.existsSync(path.join(DATA, "install.json")));
});

test("signing in, then the data arriving by itself and the self-check, in the real program", { skip }, async () => {
  await page.click(id("signin-start"));
  await page.waitForSelector(id("signin-check"));
  const login = api.logins.at(-1);
  assert.equal(await page.textContent(id("signin-check")), login.check);
  assert.equal(await page.textContent(id("signin-url")), `http://127.0.0.1:${PORT}/app/signin?login=${login.login_id}`);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(await page.locator(id("tab-book")).count(), 0);                 // not until the person approves
  api.approve({ email: "someone@example.com", country: "CA", region: "Quebec" });
  await page.waitForSelector(id("tab-book"), { timeout: 30000 });
  // nothing more is pressed: the release comes by itself, checked part by part, and the self-check runs
  await fetched();
  await page.click(id("tab-data"));
  await page.waitForSelector(id("check-pass"), { timeout: 180000 });
  assert.match(await page.textContent(id("data-state")), /release 1, 8 strategy runs/);
  // its files are in its own data folder: the release, and who signed in
  const manifest = fixture().manifest;
  for (const p of manifest.parts) assert.equal(fs.statSync(path.join(DATA, "releases", "1", p.part)).size, p.bytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA, "profile.json"), "utf8")), { email: "someone@example.com", country: "CA", region: "Quebec" });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA, "install.json"), "utf8")), { install_token: "install-token-1" });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA, "releases", "current.json"), "utf8")), { release_id: 1 });
  const rel = api.requests.filter((r) => r.path.startsWith("/api/v1/releases/"));
  assert.equal(rel.length, 1 + manifest.parts.length);
  assert.ok(rel.every((r) => r.token), "a request for the release went without the app's token");
});

test("a portfolio works out to the expected figures in the real program, and is kept on this machine", { skip }, async () => {
  await page.click(id("tab-book"));
  await page.setInputFiles(id("book-file"), { name: "b.json", mimeType: "application/json",
                                              buffer: Buffer.from(JSON.stringify({ kind: "cupel-book", version: 1, book: { ...BOOK, name: "Ours" } })) });
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 7, `${id("holdings")} tbody tr`);
  await page.click(id("tab-results"));
  await page.click(id("evaluate"));
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 7, `${id("result-holdings")} tbody tr`, { timeout: 240000 });
  for (const [testid, key] of [["fig-withdrawal", "withdrawal"], ["fig-cagr", "cagr"]]) {
    const got = Number(await page.getAttribute(id(testid), "data-raw")), want = EXPECTED.book[key];
    assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${key}: ${got} in the program, ${want} expected, by ${got - want}`);
  }
  assert.equal(await page.locator(id("no-breaks")).count(), 1);
  const kept = JSON.parse(fs.readFileSync(path.join(DATA, "books", "current.json"), "utf8"));
  assert.equal(kept.name, "Ours");
  assert.equal(kept.holdings.length, 7);
});

test("the optimizer runs in the real program and sends nothing", { skip }, async () => {
  await page.click(id("tab-optimize"));
  const before = api.requests.length;
  await page.click(id("opt-run"));
  await page.waitForSelector(id("opt-found"), { timeout: 400000 });
  const got = Number(await page.getAttribute(id("opt-withdrawal"), "data-raw"));
  // the screen optimizes the six strategies the book holds, from three starts (the exact weights of a fixed list
  // and two starts are held in tests/corehost.test.mjs): here, that it found a mix that pays more than the book did
  assert.ok(got > EXPECTED.book.withdrawal, `the optimized withdrawal ${got} is not above the book's ${EXPECTED.book.withdrawal}`);
  assert.ok((await page.textContent(id("opt-said"))).includes("start 3/3"));
  assert.equal(api.requests.length, before);
});

test("everything it asked of the API was the sign-in and the release, with nothing of the user's in it", { skip }, async () => {
  const paths = [...new Set(apiPaths().map((x) => x.replace(/parts\/.*/, "parts/…")))].sort();
  assert.deepEqual(paths, ["GET /api/v1/releases/1/parts/…", "GET /api/v1/releases/current", "POST /api/v1/app/login", "POST /api/v1/app/login/take"]);
  const sent = api.requests.map((r) => r.path + r.body).join("\n");
  for (const secret of ["400000", "580000", "RRSP", "Margin", "holdings", "balance", "Ours", "example.com", "Quebec"]) assert.ok(!sent.includes(secret), `${secret} was sent`);
});

test("closing it leaves no process behind; started again it is still signed in and asks for newer data by itself", { skip }, async () => {
  assert.equal(await close(), 0, "a process of the program was left running");
  const before = api.requests.length;
  await start();
  await fetched();
  assert.deepEqual(apiPaths(before), ["GET /api/v1/releases/current"]);        // nobody pressed anything
  assert.ok(api.requests.at(-1).token);
  assert.equal(await page.locator(id("signin-start")).count(), 0);
  assert.equal(await close(), 0);
});

test("started with cupel unreachable, it has everything and still works", { skip }, async () => {
  api.state.down = true;
  try {
    await start();
    await fetched("offline");
    await page.click(id("tab-account"));
    assert.match(await page.textContent(id("signed-in")), /someone@example\.com, Quebec/);
    await page.click(id("tab-book"));
    await page.waitForSelector(id("holdings"));
    assert.equal(await page.inputValue(id("book-name")), "Ours");
    await page.click(id("tab-results"));
    await page.click(id("evaluate"));
    await page.waitForSelector(id("fig-withdrawal"), { timeout: 240000 });
    const got = Number(await page.getAttribute(id("fig-withdrawal"), "data-raw"));
    assert.ok(Math.abs(got - EXPECTED.book.withdrawal) <= 1e-9, `${got} offline, ${EXPECTED.book.withdrawal} expected`);
    await page.click(id("tab-data"));
    assert.match(await page.textContent(id("data-bad")), /works from the data it has/);
  } finally { api.state.down = false; }
});

test("signing out tells cupel and removes the sign-in from this machine; the portfolio and the data stay", { skip }, async () => {
  await page.click(id("tab-account"));
  const before = api.requests.length;
  await page.click(id("signout"));
  await page.waitForSelector(id("signin-start"));
  assert.deepEqual(apiPaths(before), ["POST /api/v1/app/logout"]);
  assert.equal(api.tokens.size, 0);
  assert.ok(!fs.existsSync(path.join(DATA, "install.json")) && !fs.existsSync(path.join(DATA, "profile.json")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(DATA, "books", "current.json"), "utf8")).name, "Ours");
  assert.ok(fs.existsSync(path.join(DATA, "releases", "1", "runs.parquet")));
  assert.equal(await close(), 0);
});

test("the program's own folder holds only what is the user's, in files a person can read", { skip }, async () => {
  const top = fs.readdirSync(DATA).sort();
  assert.deepEqual(top.filter((f) => !["books", "releases", "settings.json"].includes(f)), []);
  assert.ok(top.includes("books") && top.includes("releases"));
  assert.ok(os.platform() === "win32");
});
