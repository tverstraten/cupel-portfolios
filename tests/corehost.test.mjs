// The core as the app runs it: src/lib/corehost.js on the Python runtime the app ships (public/pyodide) and the
// core files it bundles (public/core), given the small test release. What the app's worker does, call for call; the
// figures are held to the same expected.json the core's own tests use under CPython and Pyodide.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { EXPECTED, fixture, startCore } from "./helpers.mjs";

const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const BOOK = EXPECTED.self_check[0].book;
let core, said = [];

before(async () => {
  core = await startCore((line) => said.push(line));
});

test("the core starts on the shipped runtime and says what it is", () => {
  const v = core.call("version");
  assert.match(v.python, /^3\.\d+/);
  assert.ok(v.numpy && v.scipy && v.pyarrow && v.core);
  assert.deepEqual(Object.keys(core.call("builders")).sort(), ["cagr_dd", "equal", "sortino", "withdrawal"]);
});

test("nothing can be asked before a release is open, and it is said in words", () => {
  assert.throws(() => core.call("catalogue"), /no release is open/);
});

test("a release with a changed part is refused, and a good one is read", () => {
  const { manifest, parts } = fixture();
  const data = new Map([...parts].filter(([k]) => k.endsWith(".parquet")));
  const bad = new Map(data);
  const eq = "equity/0000101-0000204.parquet";
  const flipped = new Uint8Array(bad.get(eq));
  flipped[500] ^= 1;
  bad.set(eq, flipped);
  assert.throws(() => core.openRelease(manifest, bad), /checksum/);
  assert.throws(() => core.call("catalogue"), /no release is open/);        // the refused one did not become the one in hand
  const opened = core.openRelease(manifest, data);
  assert.equal(opened.runs, 8);
  assert.equal(opened.as_of, manifest.as_of);
  const cat = core.call("catalogue");
  assert.equal(cat.length, 8);
  assert.ok(cat.every((r) => typeof r.name === "string" && ["CAD", "USD"].includes(r.sleeve)));
});

test("the account types are the country's", () => {
  assert.deepEqual(core.call("account_types", { country: "CA" }).map((t) => t.type).sort(), ["LIF", "MARGIN", "RRSP", "TFSA"]);
  assert.deepEqual(core.call("account_types", { country: "US" }).map((t) => t.type).sort(), ["BROKERAGE", "IRA", "ROTH_IRA"]);
});

test("a book's pools and its evaluation are the expected figures", () => {
  const pools = core.call("pools", { book: BOOK });
  assert.equal(pools.capital, 580000);
  assert.deepEqual(pools.pools.map((p) => p.label), EXPECTED.pools.pools.map((p) => p.label));
  const r = core.call("evaluate", { book: BOOK });
  for (const k of ["withdrawal", "withdrawal_flat", "cagr", "sortino", "max_drawdown", "final"]) {
    assert.ok(near(r[k], EXPECTED.book[k]), `${k}: ${r[k]} computed, ${EXPECTED.book[k]} expected, by ${r[k] - EXPECTED.book[k]}`);
  }
  assert.equal(r.curve.days.length, EXPECTED.book.curve_check.n);
  assert.ok(near(r.curve.equity.reduce((a, b) => a + b, 0), EXPECTED.book.curve_check.sum, 1e-8));
  assert.deepEqual(r.breaks, []);
  assert.equal(r.holdings.length, BOOK.holdings.length);
  assert.equal(r.monte_carlo.fan.length, 31);
});

test("a rule the book breaks is said, and what cannot be computed is refused as CoreRefused", async () => {
  const { CoreRefused } = await import("../src/lib/corehost.js");
  const over = structuredClone(BOOK);
  over.holdings[0].weight += 0.05;
  assert.deepEqual(core.call("evaluate", { book: over, detail: false }).breaks.map((b) => b.rule), ["borrow"]);
  const gone = structuredClone(BOOK);
  gone.holdings[0].run = 999;
  assert.throws(() => core.call("evaluate", { book: gone }), (e) => e instanceof CoreRefused && /not in this release/.test(e.message));
});

test("the optimizer finds the expected weights and says how each start went", () => {
  said.length = 0;
  const got = core.call("optimize", { book: BOOK, builder: "withdrawal", runs: [101, 102, 103, 104, 201, 202, 203], starts: 2, max_dd: 0.35 });
  const want = EXPECTED.optimize.withdrawal;
  assert.equal(got.feasible, true);
  assert.ok(near(got.evaluation.withdrawal, want.withdrawal, 1e-6), `${got.evaluation.withdrawal} for ${want.withdrawal}`);
  assert.deepEqual(got.holdings.map((h) => [h.run, h.lever]), want.holdings.map((h) => [h.run, h.lever]));
  got.holdings.forEach((h, i) => assert.ok(Math.abs(h.weight - want.holdings[i].weight) < 1e-6, `run ${h.run}: ${h.weight} for ${want.holdings[i].weight}`));
  assert.equal(said.length, 2);
  assert.match(said[0], /start 1\/2: withdrawal/);
  assert.ok(got.evaluation.withdrawal > EXPECTED.book.withdrawal);
});

test("the self-check passes on the release's reference portfolios and fails on one altered value", () => {
  const cases = JSON.parse(new TextDecoder().decode(fixture().parts.get("reference.json")));
  const ok = core.call("self_check", { cases });
  assert.deepEqual(ok.map((c) => c.ok), [true, true]);
  cases[0].expect.cagr += 1e-6;
  const bad = core.call("self_check", { cases });
  assert.deepEqual(bad.map((c) => c.ok), [false, true]);
  assert.equal(bad[0].differences[0].figure, "cagr");
});
