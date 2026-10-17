// The app's requests to cupel (src/lib/api.js), against the stand-in API over real HTTP: the sign-in (asked for,
// pending, given once), the release only with the app's token, and what each request carries.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApiError, makeApi } from "../src/lib/api.js";
import { apiServer, fixture } from "./helpers.mjs";

let server;
before(async () => { server = await apiServer(fixture()); });
after(async () => { await server.close(); });

test("signed out, the release is not asked for at all; a token cupel does not know is refused as 401", async () => {
  const before = server.requests.length;
  const none = makeApi(server.url, fetch, () => null);
  await assert.rejects(none.current(), (e) => e instanceof ApiError && e.status === 401);
  await assert.rejects(none.part(1, "fx.parquet"), (e) => e.status === 401);
  assert.equal(server.requests.length, before, "a request was made with no token to send");
  const wrong = makeApi(server.url, fetch, () => "not-a-token");
  await assert.rejects(wrong.current(), (e) => e.status === 401 && /sign in/.test(e.message));
  assert.equal(server.requests.at(-1).token, true);
});

test("a sign-in: asked for with nothing of the user's, pending until approved, the token given once, and it reads the release", async () => {
  let token = null;
  const api = makeApi(server.url + "/", fetch, async () => token);
  const s = await api.login();
  assert.equal(s.url, `${server.url}/app/signin?login=${s.login_id}`);
  assert.equal(server.requests.at(-1).body, "");
  assert.equal(await api.take(s.secret), null);                          // not yet
  assert.equal(await api.take(s.secret), null);
  assert.equal(server.requests.at(-1).body, JSON.stringify({ secret: s.secret }));
  server.approve({ email: "a@example.com", country: "US", region: "Vermont" });
  const got = await api.take(s.secret);
  assert.deepEqual(got, { install_token: got.install_token, email: "a@example.com", country: "US", region: "Vermont" });
  await assert.rejects(api.take(s.secret), (e) => e.status === 401);     // once
  await assert.rejects(api.take("another app's guess"), (e) => e.status === 401);
  token = got.install_token;
  const m = await api.current();
  assert.equal(m.release_id, 1);
  const bytes = await api.part(1, m.parts.find((p) => p.part.startsWith("equity/")).part);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000);
  await api.logout();
  await assert.rejects(api.current(), (e) => e.status === 401);          // signed out: the token is no token
});

test("a sign-in's link is used only when it is that sign-in's page on cupel's own site", async () => {
  const SITE = "http://localhost:8814", ID = "0123456789abcdef0123456789abcdef";
  const answer = (o) => async () => new Response(JSON.stringify({ login_id: ID, secret: "s", check: "C0DE01", ...o }), { status: 201 });
  const api = (o) => makeApi("http://127.0.0.1:8814", answer(o), () => null, SITE);
  // the site's own address is not the API's here (a browser's session is the host's): the link is the site's
  assert.equal((await api({ url: `${SITE}/app/signin?login=${ID}` }).login()).login_id, ID);
  for (const url of [`https://evil.example/app/signin?login=${ID}`, "file:///C:/Windows/x", "javascript:alert(1)", "not a url", null,
                     `http://127.0.0.1:8814/app/signin?login=${ID}`,            // the API's address, not the site's
                     `http://localhost:8814.evil.example/app/signin?login=${ID}`, `http://localhost:8815/app/signin?login=${ID}`,
                     `https://localhost:8814/app/signin?login=${ID}`, `${SITE}/signin?next=https://evil.example&login=${ID}`,
                     `${SITE}/app/signin?login=${ID}&next=https://evil.example`, `${SITE}/app/signin?login=${"f".repeat(32)}`,
                     `${SITE}/app/signin?login=${ID}#x`, `${SITE}/app/signin/../../x?login=${ID}`]) {
    await assert.rejects(api({ url }).login(), (e) => e.status === 502 && /not a sign-in/.test(e.message), String(url));
  }
  for (const bad of [{ secret: "" }, { secret: null }, { login_id: "1" }, { login_id: null }, { check: null }]) {
    await assert.rejects(api({ url: `${SITE}/app/signin?login=${ID}`, ...bad }).login(), (e) => e.status === 502, JSON.stringify(bad));
  }
});

test("a part's name is sent as a path, each piece encoded, with the token in the header and never in the address", async () => {
  const asked = [];
  const fetchFn = async (url, init) => { asked.push([url, init]); return new Response(new Uint8Array([1, 2, 3])); };
  const api = makeApi("http://cupel.test/", fetchFn, () => "the-token");
  assert.deepEqual([...(await api.part(7, "equity/a b.parquet"))], [1, 2, 3]);
  assert.equal(asked[0][0], "http://cupel.test/api/v1/releases/7/parts/equity/a%20b.parquet");
  assert.deepEqual(asked[0][1], { headers: { authorization: "Bearer the-token" } });
});

test("cupel unreachable is said as that (status 0), and its own refusal in its own words", async () => {
  const down = makeApi("http://127.0.0.1:9", fetch, () => "t");
  await assert.rejects(down.login(), (e) => e instanceof ApiError && e.status === 0 && /could not be reached/.test(e.message));
  await assert.rejects(down.current(), (e) => e.status === 0);
  const api = makeApi(server.url, fetch, () => null);
  const s = await api.login();
  server.approve();
  const { install_token } = await api.take(s.secret);
  await assert.rejects(makeApi(server.url, fetch, () => install_token).part(1, "no-such.parquet"),
                       (e) => e.status === 404 && /has no part no-such\.parquet/.test(e.message));
});
