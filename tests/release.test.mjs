// The release on the user's machine (src/lib/release.js; OPPORTUNITY-PLAN-APPS.md B3): the first download, a
// download that is interrupted and taken up again, a part that does not match, the differences from the release in
// hand, and use with no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ReleaseError, inHand, readParts, sha256Hex, update } from "../src/lib/release.js";
import { memoryStore } from "../src/lib/store.js";
import { fakeApi, fixture } from "./helpers.mjs";

const N = fixture().manifest.parts.length;

test("the first download: every part fetched, checked, and only then the release in hand", async () => {
  const store = memoryStore(), api = fakeApi(fixture()), seen = [];
  assert.equal(await inHand(store), null);
  const got = await update(store, api, (p) => seen.push(p));
  assert.equal(got.changed, true);
  assert.equal(seen.length, N);
  assert.ok(seen.every((p) => p.from === "downloaded") && seen.at(-1).done === N);
  const rel = await inHand(store);
  assert.equal(rel.release_id, 1);
  const parts = await readParts(store, rel);
  for (const p of rel.manifest.parts) assert.equal(await sha256Hex(parts.get(p.part)), p.sha256);
});

test("the same release asked for again downloads nothing", async () => {
  const store = memoryStore(), api = fakeApi(fixture());
  await update(store, api);
  api.asked.length = 0;
  const again = await update(store, api);
  assert.equal(again.changed, false);
  assert.deepEqual(api.asked, ["current"]);
});

test("an interrupted download leaves nothing in hand, and resumes: the parts it had are not fetched again", async () => {
  const store = memoryStore(), api = fakeApi(fixture());
  api.failAfter = 2;
  await assert.rejects(update(store, api), /connection was lost/);
  assert.equal(await inHand(store), null);                          // not the release in hand until all of it verified
  api.failAfter = Infinity;
  api.asked.length = 0;
  const seen = [];
  await update(store, api, (p) => seen.push(p.from));
  assert.equal(seen.filter((f) => f === "kept").length, 2);
  assert.equal(api.asked.filter((a) => a.startsWith("part:")).length, N - 2);
  await readParts(store, await inHand(store));
});

test("a part that does not match is refused, and the release in hand is kept and still reads", async () => {
  const store = memoryStore(), f1 = fixture();
  await update(store, fakeApi(f1));
  // a newer release with new reference portfolios, which arrive with one byte changed
  const f2 = fixture();
  f2.manifest.release_id = 2;
  const fresh = new TextEncoder().encode(JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ name: `case ${i}` }))));
  f2.parts.set("reference.json", fresh);
  const entry = f2.manifest.parts.find((p) => p.part === "reference.json");
  entry.sha256 = await sha256Hex(fresh);
  entry.bytes = fresh.length;
  const api2 = fakeApi(f2);
  api2.corrupt = "reference.json";
  await assert.rejects(update(store, api2), (e) => e instanceof ReleaseError && /checksum/.test(e.message));
  const rel = await inHand(store);
  assert.equal(rel.release_id, 1);
  await readParts(store, rel);
  // the bad part was never written
  assert.equal(await store.readBytes("releases/2/reference.json"), null);
});

test("a newer release downloads only the parts that differ, and the one before goes once it has verified", async () => {
  const store = memoryStore(), f1 = fixture();
  await update(store, fakeApi(f1));
  const f2 = fixture();
  f2.manifest.release_id = 2;
  const changed = new TextEncoder().encode("[]");
  f2.parts.set("reference.json", changed);
  const entry = f2.manifest.parts.find((p) => p.part === "reference.json");
  entry.sha256 = await sha256Hex(changed);
  entry.bytes = changed.length;
  const api2 = fakeApi(f2), seen = [];
  const got = await update(store, api2, (p) => seen.push(`${p.from}:${p.part}`));
  assert.equal(got.release_id, 2);
  assert.deepEqual(api2.asked.filter((a) => a.startsWith("part:")), ["part:reference.json"]);
  assert.equal(seen.filter((s) => s.startsWith("copied:")).length, N - 1);
  assert.deepEqual(await store.list("releases"), ["2", "current.json"]);
  await readParts(store, await inHand(store));
});

test("with no network the release in hand is still read; with none in hand it is said", async () => {
  const store = memoryStore(), api = fakeApi(fixture());
  await update(store, api);
  api.offline = true;
  await assert.rejects(update(store, api), (e) => e.status === 0);
  await readParts(store, await inHand(store));                      // the app goes on working from it
  await assert.rejects(update(memoryStore(), api), (e) => e.status === 0);
});

test("a release in hand that was damaged on disk is found out and fetched again", async () => {
  const store = memoryStore(), api = fakeApi(fixture());
  await update(store, api);
  const at = "releases/1/fx.parquet";
  const bytes = await store.readBytes(at);
  bytes[10] ^= 1;
  await store.writeBytes(at, bytes);
  await assert.rejects(readParts(store, await inHand(store)), /no longer matches/);
  api.asked.length = 0;
  const got = await update(store, api);
  assert.equal(got.changed, true);
  assert.deepEqual(api.asked.filter((a) => a.startsWith("part:")), ["part:fx.parquet"]);
  await readParts(store, await inHand(store));
});

test("a release whose id or part names are not a release's is refused whole: nothing is asked for, written or removed", async () => {
  const { manifest, parts } = fixture();
  const evil = new Uint8Array([1, 2, 3]), sha = await sha256Hex(evil);
  const withPart = (name) => ({ ...manifest, parts: [...manifest.parts, { part: name, sha256: sha, bytes: 3 }] });
  const cases = [
    ...["../../profile.json", "..", ".", "a/../../install.json", "/profile.json", "equity/../../../books/current.json",
        "..\..\profile.json", "C:/Windows/x", "a//b", "", "manifest.json", ".hidden", "a b", "fx.parquet", "FX.parquet",
        "x".repeat(201), 7, null].map((name) => [`part ${JSON.stringify(name)}`, withPart(name)]),
    ...["../..", "1/../../books", "1", 0, -1, 1.5, null, "", {}].map((id) => [`id ${JSON.stringify(id)}`, { ...manifest, release_id: id }]),
    ["no checksum", { ...manifest, parts: [{ part: "fx.parquet", bytes: 3 }] }],
    ["no parts", { ...manifest, parts: [] }],
  ];
  for (const [what, bad] of cases) {
    const store = memoryStore();
    await store.writeText("profile.json", "mine");
    await update(store, fakeApi({ manifest, parts }));                 // a good release in hand first
    const api = fakeApi({ manifest: bad, parts: new Map([...parts, ...bad.parts.map((p) => [p.part, evil])]) });
    await assert.rejects(update(store, api), ReleaseError, what);
    assert.deepEqual(api.asked, ["current"], `${what}: a part was asked for`);
    assert.equal(await store.readText("profile.json"), "mine", what);
    assert.equal((await inHand(store)).release_id, 1, what);
    await readParts(store, await inHand(store));                       // and the one in hand still reads whole
  }
});

test("what is on disk as the release in hand is held to the same: a changed current.json or manifest is no release", async () => {
  for (const cur of ['{"release_id":"../.."}', '{"release_id":"1/../../books"}', "not json", '{"release_id":0}']) {
    const store = memoryStore();
    await update(store, fakeApi(fixture()));
    await store.writeText("releases/current.json", cur);
    assert.equal(await inHand(store), null, cur);
  }
  const store = memoryStore(), { manifest } = fixture();
  await update(store, fakeApi(fixture()));
  await store.writeText("releases/1/manifest.json", JSON.stringify({ ...manifest, parts: [{ ...manifest.parts[0], part: "../../profile.json" }] }));
  assert.equal(await inHand(store), null);
  await store.writeText("profile.json", "mine");
  const again = await update(store, fakeApi(fixture()));               // fetched again, and nothing outside it touched
  assert.equal(again.changed, true);
  assert.equal(await store.readText("profile.json"), "mine");
});
