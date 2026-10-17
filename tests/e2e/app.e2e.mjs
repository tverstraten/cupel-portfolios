// The app from end to end, as a person uses it (OPPORTUNITY-PLAN-APPS.md B1-B5, B7, B8; sign-in and the data fetched
// by the app itself, Todd 2026-10-05): the built screens loaded
// in the system's own browser engine (Edge, which is the WebView2 the Windows app draws with), the core running in
// its worker on the shipped Python runtime, and cupel's API stood in for by a server that serves the small test
// release and records every request made to it.
//
// The screens are built twice here, pointed at that server: once as a release makes them (the optimizer off) and
// once with it on. Where Tauri is not there the app keeps its files in the browser's own storage (src/lib/store.js).
//
//   npm run test:e2e
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { APP, EXPECTED, apiServer, fixture } from "../helpers.mjs";

const BOOK = EXPECTED.self_check[0].book;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
               ".wasm": "application/wasm", ".zip": "application/zip", ".whl": "application/octet-stream", ".py": "text/plain", ".png": "image/png" };

function serveDir(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(dir, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((x) => { server.closeAllConnections?.(); server.close(x); }) })));
}

function build(outDir, api, extra = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITE_")));
  execFileSync(process.execPath, [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", outDir, "--logLevel", "error"],
               { cwd: APP, env: { ...clean, VITE_CUPEL_API: api, VITE_CUPEL_SITE: api, ...extra }, stdio: "pipe" });
  return path.join(APP, outDir);
}

let api, site, siteOpt, browser, context, page;
const asked = [];                 // every request the page made, anywhere
const errors = [];

before(async () => {
  execFileSync(process.execPath, [path.join(APP, "scripts", "bundle-core.mjs")], { cwd: APP, stdio: "pipe" });
  api = await apiServer(fixture());
  site = await serveDir(build("dist-e2e", api.url));
  siteOpt = await serveDir(build("dist-e2e-opt", api.url, { VITE_CUPEL_OPTIMIZER: "on" }));
  browser = await chromium.launch({ channel: "msedge", headless: true });
  context = await browser.newContext({ locale: "en-CA", acceptDownloads: true });
  page = await context.newPage();
  page.on("request", (r) => asked.push(r.url()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
});

after(async () => {
  await browser?.close();
  await Promise.all([api?.close(), site?.close(), siteOpt?.close()]);
  for (const d of ["dist-e2e", "dist-e2e-opt"]) fs.rmSync(path.join(APP, d), { recursive: true, force: true });
});

const id = (x) => `[data-testid="${x}"]`;
const ready = (p = page) => p.waitForSelector(`${id("core-status")}[data-status="ready"]`, { timeout: 120000 });
const raw = async (testid, p = page) => Number(await p.getAttribute(id(testid), "data-raw"));
// the app's own fetch of its data has ended this way (the line itself is empty when there is no data to name)
const fetched = (p = page, status = "current") => p.waitForSelector(`${id("data-line")}[data-status="${status}"]`, { timeout: 120000, state: "attached" });
const apiPaths = (server, from = 0) => server.requests.slice(from).filter((r) => r.path.startsWith("/api/")).map((r) => `${r.method} ${r.path}`);

// A person signs in: Sign in pressed in the app, the browser opening on cupel's page, and (signed in to cupel there)
// the sign-in approved. Returns the page the app opened and the sign-in as cupel holds it.
async function signIn(p = page, server = api, who) {
  const [opened] = await Promise.all([context.waitForEvent("page"), p.click(id("signin-start"))]);
  await p.waitForSelector(id("signin-check"));
  const login = server.logins.at(-1);
  const address = opened.url();
  await opened.close();
  server.approve(who);
  await p.waitForSelector(id("tab-book"), { timeout: 30000 });
  return { address, login };
}

test("the app opens, its calculator starts from the app's own files, and until someone signs in there is only Sign in", async () => {
  await page.goto(site.url);
  await ready();
  assert.match(await page.textContent(id("core-status")), /The calculator is ready/);
  // the Python runtime and the core came from the app itself, never from the internet
  const runtime = asked.filter((u) => /pyodide|cupel_core|\.whl/.test(u));
  assert.ok(runtime.length > 8 && runtime.every((u) => u.startsWith(site.url)), "a runtime file was asked of another address");
  assert.equal(await page.locator(id("signin")).count(), 1);
  for (const tab of ["book", "results", "data", "account"]) assert.equal(await page.locator(id(`tab-${tab}`)).count(), 0, tab);
  assert.equal(await page.locator(id("data-line")).count(), 0);
  assert.equal(api.requests.length, 0, "cupel was asked for something before anyone signed in");
});

test("signing in: the browser opens on cupel's page, the app shows the same code, and nothing is typed into the app", async () => {
  // started and given up: the app stops asking, and that sign-in is never used
  const [first] = await Promise.all([context.waitForEvent("page"), page.click(id("signin-start"))]);
  await page.waitForSelector(id("signin-check"));
  await first.close();
  await page.click(id("signin-cancel"));
  await page.waitForSelector(id("signin-start"));
  const given = api.requests.length;
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal(api.requests.length, given, "the app went on asking after Cancel");
  api.approve({ email: "someone-else@example.com", country: "US", region: "Vermont" });     // approved too late: nobody is asking
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(await page.locator(id("tab-book")).count(), 0);

  // started again: pending until the person approves in their browser
  const [opened] = await Promise.all([context.waitForEvent("page"), page.click(id("signin-start"))]);
  await page.waitForSelector(id("signin-check"));
  const login = api.logins.at(-1);
  assert.equal(api.logins.length, 2);
  assert.equal(opened.url(), `${api.url}/app/signin?login=${login.login_id}`);              // cupel's own page, and this sign-in
  assert.ok(!opened.url().includes(login.secret));
  assert.equal(await page.textContent(id("signin-check")), login.check);
  assert.equal(await page.textContent(id("signin-url")), opened.url());                    // and the address, should the browser not open
  await opened.close();
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal(await page.locator(id("tab-book")).count(), 0);                             // asked, and told: not yet
  assert.ok(apiPaths(api, given).filter((x) => x === "POST /api/v1/app/login/take").length >= 2);
  api.approve();
  await page.waitForSelector(id("tab-book"), { timeout: 30000 });
  assert.equal(await page.locator(id("signin")).count(), 0);
  // what the app sent to sign in: a request with nothing in it, and the secret it was given. Nothing of the person's.
  const sent = api.requests.filter((r) => r.path.startsWith("/api/v1/app/login"));
  assert.ok(sent.filter((r) => r.path === "/api/v1/app/login").every((r) => r.body === ""));
  assert.ok(sent.filter((r) => r.path.endsWith("/take")).every((r) => /^\{"secret":"secret-[12]-s+"\}$/.test(r.body)));
  assert.deepEqual(api.logins.map((l) => l.taken), [false, true]);
  await page.click(id("tab-account"));
  assert.match(await page.textContent(id("signed-in")), /Signed in as someone@example\.com, Ontario/);
});

test("the data arrives by itself: nothing is pressed, every part is checked, and the self-check passes", async () => {
  await fetched();
  await page.click(id("tab-data"));
  assert.match(await page.textContent(id("data-state")), /Data as of 2025-12-31 \(release 1, 8 strategy runs\)/);
  assert.match(await page.textContent(id("data-ok")), /Newer data was fetched and checked/);
  await page.waitForSelector(id("check-pass"), { timeout: 120000 });
  assert.match(await page.textContent(id("check-pass")), /2 reference portfolios match/);
  assert.match(await page.textContent(id("data-line")), /data as of 2025-12-31/);
  // every request for the release carried the app's token, and none before it had one
  const rel = api.requests.filter((r) => r.path.startsWith("/api/v1/releases/"));
  assert.equal(rel.length, 1 + fixture().manifest.parts.length);
  assert.ok(rel.every((r) => r.token));
  // asked again (nobody has to): nothing new to fetch
  const before = api.requests.length;
  await page.click(id("data-again"));
  await page.waitForFunction((sel) => /newest data/.test(document.querySelector(sel)?.textContent ?? ""), id("data-ok"));
  assert.deepEqual(apiPaths(api, before), ["GET /api/v1/releases/current"]);
});

test("a portfolio is entered by hand: accounts, their money, strategies and weights", async () => {
  await page.click(id("tab-book"));
  await page.fill(id("book-name"), "Mine");
  await page.click(id("acct-add"));
  await page.selectOption(id("acct-type-0"), "RRSP");
  await page.fill(id("acct-name-0"), "RRSP");
  await page.fill(id("acct-balance-0"), "400000");
  await page.fill(id("acct-usd-0"), "150000");
  await page.waitForSelector(id("pools"));
  assert.match(await page.textContent(id("capital")), /400,000 CAD in all/);
  const pools = await page.locator(`${id("pools")} li`).allTextContents();
  assert.equal(pools.length, 2);
  assert.match(pools[0], /CAD registered: 250,000 CAD \(62\.5% of the total\)/);
  // a strategy is added to the money it may be held in, and only there
  await page.fill(id("cat-search"), "index fund");
  assert.equal(await page.locator(`${id("catalogue")} tbody tr`).count(), 2);
  await page.click(id("add-101-CAD-0"));
  await page.click(id("add-201-USD-0"));
  assert.equal(await page.locator(id("add-101-USD-0")).count(), 0);           // a CAD run is never offered US dollars
  await page.fill(id("weight-101-CAD-0"), "100");
  await page.fill(id("weight-201-USD-0"), "60");
  const totals = await page.locator(`${id("pool-totals")} li`).allTextContents();
  assert.match(totals[0], /100\.0% of its money is invested$/);
  assert.match(totals[1], /60\.0% of its money is invested \(the rest is cash\)/);
  await page.click(id("tab-results"));
  await page.click(id("evaluate"));
  await page.waitForSelector(id("result"), { timeout: 120000 });
  assert.match(await page.textContent(id("cash")), /USD registered: 15\.0% of the total is cash/);
  assert.equal(await page.locator(id("no-breaks")).count(), 1);
  assert.ok((await raw("fig-withdrawal")) > 0.01);
});

test("a portfolio opened from a file works out to the expected figures, to the last digit kept", async () => {
  await page.click(id("tab-book"));
  await page.setInputFiles(id("book-file"), { name: "book.cupel-book.json", mimeType: "application/json",
                                              buffer: Buffer.from(JSON.stringify({ kind: "cupel-book", version: 1, book: BOOK })) });
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 7, `${id("holdings")} tbody tr`);
  assert.match(await page.textContent(id("capital")), /580,000 CAD in all/);
  await page.click(id("tab-results"));
  await page.click(id("evaluate"));
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 7, `${id("result-holdings")} tbody tr`, { timeout: 180000 });
  for (const [testid, key] of [["fig-withdrawal", "withdrawal"], ["fig-cagr", "cagr"]]) {
    const got = await raw(testid), want = EXPECTED.book[key];
    assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${key}: ${got} on the screen, ${want} expected, by ${got - want}`);
  }
  assert.equal(await page.locator(id("no-breaks")).count(), 1);
  assert.equal(await page.locator(`${id("curve")} path.line`).count(), 1);
  assert.equal(await page.locator(`${id("fan")} path`).count(), 5);
  assert.match(await page.textContent(id("result")), /hindsight experiment/);
  assert.match(await page.textContent(id("result")), /not orders/);
});

test("a rule the portfolio breaks is said, and the portfolio is left as entered", async () => {
  await page.click(id("tab-book"));
  await page.fill(id("weight-101-CAD-0"), "60");                              // the registered accounts now hold more than they have
  assert.match((await page.locator(`${id("pool-totals")} li`).allTextContents())[0], /CAD registered: 118\.6% of its money is invested \(more than it has\)/);
  await page.fill(id("book-name"), "Mine");
  await page.click(id("tab-results"));
  assert.match(await page.textContent("main"), /changed since this was worked out/);
  await page.click(id("evaluate"));
  await page.waitForSelector(id("breaks"), { timeout: 180000 });
  assert.match(await page.textContent(id("breaks")), /cannot borrow/);
  await page.click(id("tab-book"));
  assert.equal(await page.inputValue(id("weight-101-CAD-0")), "60");
});

test("the portfolio is saved to a file that opens again as the same portfolio", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click(id("book-export"))]);
  const file = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.equal(file.kind, "cupel-book");
  assert.deepEqual(file.release, { release_id: 1, as_of: "2025-12-31" });
  assert.equal(file.book.accounts.length, 3);
  assert.equal(file.book.holdings.length, 7);
  await page.setInputFiles(id("book-file"), { name: "x.json", mimeType: "application/json", buffer: Buffer.from("this is not a book") });
  assert.match(await page.textContent(id("notice")), /not a Cupel portfolio/);
  assert.equal(await page.locator(`${id("holdings")} tbody tr`).count(), 7);    // the one in hand is untouched
});

test("French: every screen, chosen once and kept", async () => {
  await page.selectOption(id("lang"), "fr");
  assert.equal(await page.textContent(id("tab-book")), "Portefeuille");
  assert.match(await page.textContent("footer"), /pas des conseils/);
  await page.click(id("tab-data"));
  assert.match(await page.textContent(id("data-state")), /Données en date du 2025-12-31/);
  await page.click(id("tab-account"));
  assert.match(await page.textContent(id("signed-in")), /Connecté : someone@example\.com, Ontario/);
  await page.reload();
  await ready();
  assert.equal(await page.textContent(id("tab-book")), "Portefeuille");        // remembered
  assert.match(await page.textContent(id("core-status")), /Le calculateur est prêt/);
  await page.selectOption(id("lang"), "en");
  await fetched();
});

test("started again, the app is still signed in and asks for newer data by itself; with cupel unreachable it all still works", async () => {
  let before = api.requests.length;
  await page.reload();
  await ready();
  await fetched();                                                           // nobody pressed anything
  assert.deepEqual(apiPaths(api, before), ["GET /api/v1/releases/current"]);
  assert.ok(api.requests.at(-1).token);
  api.state.down = true;
  try {
    before = api.requests.length;
    await page.reload();
    await ready();
    await fetched(page, "offline");
    assert.match(await page.textContent(id("data-line")), /data as of 2025-12-31 · cupel could not be reached/);
    assert.equal(await page.locator(id("signin")).count(), 0);                 // unreachable is not signed out
    await page.click(id("tab-account"));
    assert.match(await page.textContent(id("signed-in")), /Signed in as someone@example\.com, Ontario/);
    await page.click(id("tab-book"));
    await page.waitForSelector(id("holdings"));
    assert.equal(await page.inputValue(id("book-name")), "Mine");
    assert.equal(await page.locator(`${id("holdings")} tbody tr`).count(), 7);
    await page.fill(id("weight-101-CAD-0"), "41.42857");
    await page.click(id("tab-results"));
    await page.click(id("evaluate"));
    await page.waitForSelector(id("fig-withdrawal"), { timeout: 180000 });
    assert.ok((await raw("fig-withdrawal")) > 0.05);
    await page.click(id("tab-data"));
    assert.match(await page.textContent(id("data-state")), /release 1/);
    assert.match(await page.textContent(id("data-bad")), /could not be reached\. The app works from the data it has/);
  } finally { api.state.down = false; }
});

test("signed out, or its sign-in ended by cupel, the app asks to sign in again; the portfolio and the data stay", async () => {
  // signing out tells cupel, whose token it then no longer is
  await page.click(id("tab-account"));
  let before = api.requests.length;
  await page.click(id("signout"));
  await page.waitForSelector(id("signin-start"));
  assert.deepEqual(apiPaths(api, before), ["POST /api/v1/app/logout"]);
  assert.ok(api.requests.at(-1).token);
  assert.equal(api.tokens.size, 0);
  assert.equal(await page.locator(id("tab-book")).count(), 0);
  await page.reload();
  await ready();
  assert.equal(await page.locator(id("signin-start")).count(), 1);             // still signed out after a restart
  before = api.requests.length;
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(api.requests.length, before, "signed out, the app still asked cupel for something");
  await signIn();
  await fetched();
  await page.waitForSelector(id("holdings"));
  assert.equal(await page.inputValue(id("book-name")), "Mine");               // the same portfolio, on this machine all along
  // cupel ends the sign-in (the token revoked): the next start finds out and asks to sign in; nothing is lost
  api.revoke();
  await page.reload();
  await ready();
  await page.waitForSelector(id("signin-start"), { timeout: 30000 });
  assert.equal(await page.locator(id("tab-book")).count(), 0);
  const again = await signIn();
  assert.match(again.address, /\/app\/signin\?login=0+4$/);
  await fetched();
  assert.equal(await page.locator(`${id("holdings")} tbody tr`).count(), 7);
});

test("a newer release that arrives damaged is refused, and the data in hand is kept", async () => {
  const f = fixture();
  f.manifest.release_id = 2;
  const other = await apiServer(f);
  let bad;
  try {
    other.state.corrupt = "fx.parquet";
    // the same app, built against the second server
    const dir = build("dist-e2e-bad", other.url);
    bad = await serveDir(dir);
    const p = await context.newPage();
    await p.goto(bad.url);
    await ready(p);
    await signIn(p, other);
    // fx.parquet of release 2 has the same checksum as release 1's in the manifest, and a first fetch here has
    // nothing in hand to copy from: the damaged bytes are fetched, do not match, and are refused
    await fetched(p, "refused");
    await p.click(id("tab-data"));
    assert.match(await p.textContent(id("data-bad")), /refused and the data in hand was kept.*checksum/);
    assert.match(await p.textContent(id("data-state")), /The app has no data yet/);
    await p.close();
  } finally {
    await bad?.close();
    await other.close();
    fs.rmSync(path.join(APP, "dist-e2e-bad"), { recursive: true, force: true });
  }
});

test("nothing left the machine but the sign-in and the release", async () => {
  const outside = asked.filter((u) => !u.startsWith(site.url) && !u.startsWith("blob:") && !u.startsWith("data:"));
  assert.ok(outside.length > 0 && outside.every((u) => u.startsWith(api.url + "/api/v1/")), `asked of another address: ${outside.filter((u) => !u.startsWith(api.url))}`);
  const paths = [...new Set(apiPaths(api).map((x) => x.replace(/parts\/.*/, "parts/…")))].sort();
  assert.deepEqual(paths, ["GET /api/v1/releases/1/parts/…", "GET /api/v1/releases/current", "POST /api/v1/app/login",
                           "POST /api/v1/app/login/take", "POST /api/v1/app/logout"]);
  // the only other thing asked of cupel was by the person's browser: the sign-in page the app opened
  const pages = [...new Set(api.requests.filter((r) => !r.path.startsWith("/api/")).map((r) => r.path.replace(/\d{32}$/, "…")))].sort();
  assert.deepEqual(pages.filter((x) => x !== "/favicon.ico"), ["/app/signin?login=…"]);
  // nothing of the user's money in anything that was sent: no balance, no account, no holding
  const sent = api.requests.map((r) => r.path + r.body).join("\n");
  for (const secret of ["400000", "150000", "580000", "RRSP", "TFSA", "Margin", "holdings", "balance", "Mine", "example.com", "Ontario"]) {
    assert.ok(!sent.includes(secret), `${secret} was sent to cupel`);
  }
  assert.deepEqual(errors.filter((e) => !/Failed to load resource|ERR_|net::/.test(e)), []);
});

test("a release build has no optimizer; a build with it switched on finds the expected weights and can be stopped", async () => {
  assert.equal(await page.locator(id("tab-optimize")).count(), 0);
  const p = await context.newPage();
  const sentBefore = api.requests.length;
  await p.goto(siteOpt.url);
  await ready(p);
  await signIn(p);
  await p.click(id("tab-data"));
  await p.waitForSelector(id("check-pass"), { timeout: 120000 });
  await p.click(id("tab-book"));
  await p.setInputFiles(id("book-file"), { name: "b.json", mimeType: "application/json",
                                           buffer: Buffer.from(JSON.stringify({ kind: "cupel-book", version: 1, book: BOOK })) });
  await p.waitForFunction((sel) => document.querySelectorAll(sel).length === 7, `${id("holdings")} tbody tr`);
  await p.click(id("tab-optimize"));
  const during = api.requests.length;
  await p.click(id("opt-run"));
  await p.waitForSelector(id("stop"));
  await p.click(id("stop"));                                                  // stopped in the middle
  // (stopping starts the calculator afresh, which takes as long as its first start: tens of seconds on a busy machine)
  await p.waitForFunction((sel) => /Stopped/.test(document.querySelector(sel)?.textContent ?? ""), id("notice"), { timeout: 120000 });
  await ready(p);
  await p.click(id("opt-run"));                                               // and it works again after
  await p.waitForSelector(id("opt-found"), { timeout: 300000 });
  const got = Number(await p.getAttribute(id("opt-withdrawal"), "data-raw"));
  assert.ok(got > EXPECTED.book.withdrawal, `the optimized withdrawal ${got} is not above the book's ${EXPECTED.book.withdrawal}`);
  assert.ok((await p.textContent(id("opt-said"))).includes("start 3/3"));
  assert.equal(api.requests.length, during, "something was sent to cupel during the optimization");
  assert.ok(api.requests.length > sentBefore);
  await p.click(id("opt-use"));
  await p.click(id("tab-book"));
  assert.ok((await p.locator(`${id("holdings")} tbody tr`).count()) >= 4);
  await p.close();
});
