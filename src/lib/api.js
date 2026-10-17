// cupel's API, as the app calls it (OPPORTUNITY-PLAN-GENERAL.md 1.12; web/lib/api.js describes it). These are the
// only requests the app ever makes (OPPORTUNITY-PLAN-APPS.md B1): its user's sign-in, and the release for a
// signed-in app. Nothing about the user's accounts, balances, books or goals is in any of them: the functions below
// take no such thing, and tests/policy.test.mjs holds the list of paths to exactly these.
//
// Sign-in (Todd, 2026-10-05: "the user should have to login and then the app should silently get the data using an
// api"): the app asks for a sign-in (`login`), opens the link it is given in the person's own browser, where they
// sign in to cupel and approve, and asks (`take`) until it is given its install token. The app sends nothing of the
// person's: who they are is what they tell cupel's site in their browser. The token then goes with every request for
// the release, as `Authorization: Bearer`.
//
// `base` is the API's origin, fixed when the app is built (VITE_CUPEL_API). `fetch` is the browser's, or Tauri's
// (which the app's permissions hold to that one origin). `token()` gives the install token in hand, or null. `site`
// is cupel's site as a browser reaches it (VITE_CUPEL_SITE): the one place a sign-in's link may point.

export const PATHS = {
  login: () => "/api/v1/app/login",
  take: () => "/api/v1/app/login/take",
  logout: () => "/api/v1/app/logout",
  current: () => "/api/v1/releases/current",
  part: (id, part) => `/api/v1/releases/${id}/parts/${part.split("/").map(encodeURIComponent).join("/")}`,
};

// status 0: cupel was not reached; 401: the app is not signed in (or no longer)
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function makeApi(base, fetchFn = globalThis.fetch, token = () => null, site = base) {
  const origin = base.replace(/\/+$/, "");
  const said = async (r) => {
    try { return (await r.json()).error; } catch { return null; }
  };
  const ask = async (p, init) => {
    let r;
    try {
      r = await fetchFn(origin + p, init);
    } catch (e) {
      throw new ApiError(`cupel could not be reached (${e?.message ?? e})`, 0);
    }
    if (!r.ok) throw new ApiError((await said(r)) ?? `cupel answered ${r.status}`, r.status);
    return r;
  };
  const signed = async () => {
    const tok = await token();
    if (!tok) throw new ApiError("not signed in", 401);
    return { headers: { authorization: `Bearer ${tok}` } };
  };
  return {
    base,
    // a sign-in asked for: {login_id, secret, check, url, expires_in}. `url` is opened in the person's browser and is
    // believed only when it is this sign-in's page on cupel's own site; `check` is the code the app and that page
    // both show
    async login() {
      const s = await (await ask(PATHS.login(), { method: "POST" })).json();
      let at = null;
      try { at = new URL(s.url); } catch { /* refused below */ }
      const ok = at && at.origin === new URL(site).origin && at.pathname === "/app/signin"
        && typeof s.login_id === "string" && /^[0-9a-f]{32}$/.test(s.login_id) && at.search === `?login=${s.login_id}` && !at.hash
        && typeof s.secret === "string" && s.secret && typeof s.check === "string";
      if (!ok) throw new ApiError("cupel's answer to the sign-in was not a sign-in: not used", 502);
      return s;
    },
    // whether the sign-in was approved: null (not yet), or once {install_token, email, country, region}
    async take(secret) {
      const r = await ask(PATHS.take(), { method: "POST", headers: { "content-type": "application/json" },
                                          body: JSON.stringify({ secret }) });
      return r.status === 202 ? null : r.json();
    },
    // the app signs out: its token is no token from then on
    async logout() { await ask(PATHS.logout(), { method: "POST", ...(await signed()) }); },
    // the current release's manifest: {release_id, as_of, rating_method, parts: [{part, sha256, bytes}], ...}
    async current() { return (await ask(PATHS.current(), await signed())).json(); },
    async part(id, part) { return new Uint8Array(await (await ask(PATHS.part(id, part), await signed())).arrayBuffer()); },
  };
}
