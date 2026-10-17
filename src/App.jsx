// The app's screens (OPPORTUNITY-PLAN-APPS.md B2-B5, B7, B8). Until its user has signed in there is one screen: Sign
// in. Signed in, the app fetches its data by itself (at sign-in, and each time it starts), and there are four places:
// Portfolio (the accounts, the strategies, what is held), Results (the book as entered, worked out by the core), Data
// (the data in hand and the self-check) and Account (who is signed in; sign out); and Optimize where a build has it
// switched on. Every word comes from src/lib/strings.js by its key; every figure comes from the core, through
// src/lib/core.js.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeApi } from "./lib/api.js";
import { exportBook, fitToPools, fromPool, importBook, newBook, poolKey, poolTotals, setHolding, toPool } from "./lib/book.js";
import { openInBrowser } from "./lib/browser.js";
import { startCore } from "./lib/core.js";
import { openFolderSource } from "./lib/foldersource.js";
import { API, OPTIMIZER, SITE } from "./lib/flags.js";
import { inHand, readParts, update } from "./lib/release.js";
import { inTauri, openStore } from "./lib/store.js";
import { LANGUAGES, formats, systemLanguage, translator } from "./lib/strings.js";
import { Fan, Line } from "./Charts.jsx";

// Tauri's own fetch where there is one (held to cupel's API by the app's permissions); the browser's otherwise
async function apiFetch() {
  if (!inTauri()) return globalThis.fetch.bind(globalThis);
  return (await import("@tauri-apps/plugin-http")).fetch;
}

const TABS = ["book", "results", ...(OPTIMIZER ? ["optimize"] : []), "data", "account"];
const NAV = { book: "nav.book", results: "nav.results", optimize: "nav.optimize", data: "nav.data", account: "nav.account" };
const TAKE_EVERY_MS = 1500;                 // how often the app asks whether its sign-in was approved

export default function App() {
  const [lang, setLang] = useState(systemLanguage());
  const t = useMemo(() => translator(lang), [lang]);
  const f = useMemo(() => formats(lang), [lang]);
  const [tab, setTab] = useState("book");
  const [coreState, setCoreState] = useState({ status: "starting" });
  const [loaded, setLoaded] = useState(false);           // what was kept from last time has been read
  const [profile, setProfile] = useState(null);          // {email, country, region}: who is signed in
  const [release, setRelease] = useState(null);          // {release_id, manifest}: the data in hand
  const [data, setData] = useState({ status: "idle" });  // the fetch: idle | fetching | current | offline | refused
  const [check, setCheck] = useState(null);              // the self-check: {none} | {results}
  const [catalogue, setCatalogue] = useState([]);
  const [book, setBookState] = useState(newBook());
  const [pools, setPools] = useState(null);
  const [poolsError, setPoolsError] = useState(null);
  const [result, setResult] = useState(null);            // {of: the book's text when worked out, value}
  const [busy, setBusy] = useState(null);                // what is working, in words
  const [notice, setNotice] = useState(null);
  const [said, setSaid] = useState([]);                  // the optimizer's progress lines
  const store = useRef(null), core = useRef(null), api = useRef(null), token = useRef(null), syncing = useRef(false);
  const folderInput = useRef(null);

  const openRelease = useCallback(async (rel) => {
    const parts = await readParts(store.current, rel);
    const core_parts = new Map([...parts].filter(([k]) => k.endsWith(".parquet")));
    await core.current.openRelease(rel.manifest, core_parts);
    setCatalogue(await core.current.call("catalogue"));
    setRelease(rel);
  }, []);

  // the reference portfolios published with the data, computed here: after each fetch, and when asked
  const selfCheck = useCallback(async (rel) => {
    const raw = await store.current.readBytes(`releases/${rel.release_id}/reference.json`);
    if (!raw) return setCheck({ none: true });
    const cases = JSON.parse(new TextDecoder().decode(raw));
    setCheck({ results: await core.current.call("self_check", { cases }) });
  }, []);

  const signedOutHere = useCallback(async () => {
    token.current = null;
    await store.current.remove("install.json");
    await store.current.remove("profile.json");
    setProfile(null);
  }, []);

  // Load a release from a folder the user selects: same result as a successful sync(), but no API or token needed.
  // The store writes, readParts, core.openRelease, catalogue, and selfCheck logic live in openFolderSource
  // (src/lib/foldersource.js) so they can be exercised in Node tests without a browser.
  const openFromFolder = useCallback(async (e) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files.length) return;
    try {
      const { rel, catalogue, selfCheckResults } = await openFolderSource(store.current, core.current, files);
      setCatalogue(catalogue);
      setRelease(rel);
      setData({ status: "current", changed: true });
      const offlineProfile = { email: t("data.offline.label"), country: null, region: null, offline: true };
      await store.current.writeText("profile.json", JSON.stringify(offlineProfile));
      setProfile(offlineProfile);
      setCheck(selfCheckResults !== null ? { results: selfCheckResults } : { none: true });
      setTab("book");
    } catch (err) {
      setNotice(String(err.message));
    }
  }, [t]);

  // The data, fetched by the app itself: nobody presses anything. The newest release is asked for with the app's
  // token, each part checked, and the one in hand replaced only when all of it has verified (src/lib/release.js).
  // cupel unreachable: the app works from what it has. The token refused: the user signs in again.
  const sync = useCallback(async () => {
    if (syncing.current || !token.current) return;
    syncing.current = true;
    setData({ status: "fetching" });
    try {
      const got = await update(store.current, api.current, (p) => setData({ status: "fetching", progress: p }));
      await openRelease(got);
      setData({ status: "current", changed: got.changed });
      await selfCheck(got);
    } catch (e) {
      if (e.status === 401) { await signedOutHere(); setData({ status: "idle" }); }
      else setData(e.status === 0 ? { status: "offline" } : { status: "refused", why: String(e.message) });
    } finally { syncing.current = false; }
  }, [openRelease, selfCheck, signedOutHere]);

  // --- start: the store, the calculator, what was kept from last time, then the data --------------------------
  useEffect(() => {
    let off = false;
    (async () => {
      const s = (store.current = await openStore());
      api.current = makeApi(API, await apiFetch(), () => token.current, SITE);
      const settings = JSON.parse((await s.readText("settings.json")) ?? "{}");
      if (settings.lang in LANGUAGES) setLang(settings.lang);
      const p = await s.readText("profile.json"), install = await s.readText("install.json");
      if (install) token.current = JSON.parse(install).install_token ?? null;
      if (p) { const prof = JSON.parse(p); if (token.current || prof.offline) setProfile(prof); }
      const kept = await s.readText("books/current.json");
      if (kept) setBookState(JSON.parse(kept));
      setLoaded(true);
      core.current = startCore((line) => setSaid((x) => [...x, line]));
      try {
        const v = await core.current.started();
        if (off) return;
        const rel = await inHand(s);
        if (rel) await openRelease(rel).catch(() => {});       // damaged on disk: the fetch below brings it again
        setCoreState({ status: "ready", ...v });
      } catch (e) {
        if (!off) setCoreState({ status: "failed", why: String(e?.message ?? e) });
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // signed in and the calculator ready: fetch the data (at each start, and right after a sign-in)
  useEffect(() => {
    if (profile && coreState.status === "ready") sync();
  }, [profile, coreState.status, sync]);

  const signedIn = async (got) => {
    // the install token is the app's proof of who signed in: kept in the app's own folder, sent only to cupel's API
    await store.current.writeText("install.json", JSON.stringify({ install_token: got.install_token }));
    const p = { email: got.email, country: got.country, region: got.region };
    await store.current.writeText("profile.json", JSON.stringify(p));
    token.current = got.install_token;
    if (book.country !== p.country && !book.accounts.length) setBook(newBook(p.country));
    setProfile(p);
    setTab("book");
  };
  const signOut = async () => {
    await api.current.logout().catch(() => {});                // cupel unreachable: signed out here all the same
    await signedOutHere();
  };

  const chooseLang = async (l) => {
    setLang(l);
    await store.current?.writeText("settings.json", JSON.stringify({ lang: l }));
  };

  const setBook = useCallback((b) => {
    setBookState(b);
    store.current?.writeText("books/current.json", JSON.stringify(b));
  }, []);

  // --- the pools the accounts form: asked of the core whenever the accounts change ------------------------------
  const acctKey = JSON.stringify([book.country, book.accounts, book.buying_power, book.collateral, book.margin]);
  useEffect(() => {
    if (!release || coreState.status !== "ready" || !book.accounts.length) { setPools(null); setPoolsError(null); return; }
    let off = false;
    core.current.call("pools", { book }).then((p) => {
      if (off) return;
      setPools(p); setPoolsError(null);
      const fit = fitToPools(book, p);
      if (fit.gone.length) { setBook(fit.book); setNotice(t("book.dropped", { n: fit.gone.length })); }
    }).catch((e) => { if (!off) { setPools(null); setPoolsError(String(e.message)); } });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acctKey, release, coreState.status]);

  const bookText = JSON.stringify(book);
  const names = useMemo(() => new Map(catalogue.map((r) => [r.run_id, r])), [catalogue]);
  const ccy = pools?.currency ?? (book.country === "US" ? "USD" : "CAD");

  const evaluate = async () => {
    setBusy(t("working")); setNotice(null);
    try {
      setResult({ of: bookText, value: await core.current.call("evaluate", { book }) });
    } catch (e) {
      setResult({ of: bookText, error: String(e.message) });
    } finally { setBusy(null); }
  };

  const stop = async () => { await core.current.stop().catch(() => {}); setBusy(null); setNotice(t("stopped")); };

  return (
    <div className="app" lang={lang}>
      <header>
        <div className="brand"><span className="mark" aria-hidden="true">◒</span> {t("app.name")}</div>
        <nav>
          {profile && TABS.map((k) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} data-testid={`tab-${k}`}>{t(NAV[k])}</button>
          ))}
        </nav>
        <label className="lang">{t("lang.label")}{" "}
          <select value={lang} onChange={(e) => chooseLang(e.target.value)} data-testid="lang">
            {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </header>

      <p className="status" data-testid="core-status" data-status={coreState.status}>
        {coreState.status === "starting" && t("core.starting")}
        {coreState.status === "ready" && t("core.ready", { seconds: f.num(coreState.seconds, 1) })}
        {coreState.status === "failed" && t("core.failed", { why: coreState.why })}
        {profile && <span data-testid="data-line" data-status={data.status}>
          {data.status === "fetching" && <> · {t("data.fetching")}</>}
          {data.status !== "fetching" && release && <> · {t("data.asOf", { asOf: release.manifest.as_of })}</>}
          {data.status === "offline" && <> · {t("data.offlineShort")}</>}
        </span>}
        {busy && <> · <b>{busy}</b> <button onClick={stop} data-testid="stop">{t("stop")}</button></>}
      </p>
      {notice && <p className="notice" data-testid="notice">{notice}</p>}

      <main>
        {loaded && !profile && <SignIn t={t} api={api} onSignedIn={signedIn}
                                       onOpenFolder={() => folderInput.current?.click()} coreReady={coreState.status === "ready"} />}
        {profile && tab === "account" && <Account t={t} profile={profile} signOut={signOut} />}
        {profile && tab === "data" && <Data t={t} release={release} data={data} check={check} sync={sync}
                                            selfCheck={() => selfCheck(release)} offline={profile?.offline}
                                            onOpenFolder={() => folderInput.current?.click()} />}
        {profile && tab === "book" && <Book t={t} f={f} core={core} book={book} setBook={setBook} pools={pools} poolsError={poolsError}
                                            catalogue={catalogue} names={names} ccy={ccy} release={release} setNotice={setNotice}
                                            country={profile.country} />}
        {profile && tab === "results" && <Results t={t} f={f} book={book} pools={pools} names={names} result={result}
                                                  stale={result && result.of !== bookText} evaluate={evaluate} busy={!!busy} ccy={ccy} />}
        {profile && OPTIMIZER && tab === "optimize" && <Optimize t={t} f={f} core={core} book={book} setBook={setBook} names={names}
                                                                 pools={pools} said={said} setSaid={setSaid} busy={busy} setBusy={setBusy} />}
      </main>
      <footer>{t("app.notAdvice")}</footer>
      <input ref={folderInput} type="file" webkitdirectory="" hidden onChange={openFromFolder} data-testid="folder-input" />
    </div>
  );
}

// --- Sign in (B2; Todd, 2026-10-05: "the user should have to login"). The app asks cupel for a sign-in, opens the
// page it is given in the person's own browser, and waits: they sign in to cupel there and approve, checking the
// code shown here against the one shown there. Nothing is typed into the app, and the app sends nothing of theirs. ---
function SignIn({ t, api, onSignedIn, onOpenFolder, coreReady }) {
  const [pending, setPending] = useState(null);          // {url, check}: a sign-in waiting to be approved
  const [error, setError] = useState(null);
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);         // leaving the screen stops the asking

  const start = async () => {
    const mine = ++run.current;
    setError(null);
    try {
      const s = await api.current.login();
      if (mine !== run.current) return;
      setPending({ url: s.url, check: s.check });
      await openInBrowser(s.url);
      const until = Date.now() + (s.expires_in ?? 600) * 1000;
      while (mine === run.current) {
        await new Promise((r) => setTimeout(r, TAKE_EVERY_MS));
        if (mine !== run.current) return;
        if (Date.now() > until) throw Object.assign(new Error(t("signin.expired")), { said: true });
        let got = null;
        try {
          got = await api.current.take(s.secret);
        } catch (e) {
          if (e.status !== 0) throw e.status === 401 ? Object.assign(new Error(t("signin.expired")), { said: true }) : e;
        }                                                 // unreachable for a moment: asked again
        if (got) { if (mine === run.current) await onSignedIn(got); return; }
      }
    } catch (e) {
      if (mine !== run.current) return;
      setPending(null);
      setError(e.said ? e.message : e.status === 0 ? t("signin.offline") : t("signin.refused", { why: String(e.message) }));
    }
  };
  const cancel = () => { run.current++; setPending(null); };

  return (
    <section data-testid="signin">
      <h1>{t("app.tagline")}</h1>
      <h2>{t("signin.title")}</h2>
      {!pending ? (
        <>
          <p className="mute">{t("signin.intro")}</p>
          <button onClick={start} data-testid="signin-start">{t("signin.start")}</button>
        </>
      ) : (
        <>
          <p>{t("signin.waiting")}</p>
          <p className="code" data-testid="signin-check">{pending.check}</p>
          <p className="mute">{t("signin.link")} <span data-testid="signin-url" style={{ userSelect: "all" }}>{pending.url}</span></p>
          <button onClick={() => openInBrowser(pending.url)} data-testid="signin-open">{t("signin.open")}</button>{" "}
          <button onClick={cancel} data-testid="signin-cancel">{t("signin.cancel")}</button>
        </>
      )}
      {error && <p className="bad" data-testid="signin-error">{error}</p>}
      <hr />
      <p className="mute">{t("signin.orFile")}</p>
      <button onClick={onOpenFolder} disabled={!coreReady} data-testid="signin-folder">{t("signin.openFolder")}</button>
    </section>
  );
}

// --- Account: who is signed in, and signing out ------------------------------------------------------------------
function Account({ t, profile, signOut }) {
  return (
    <section>
      <h2>{t("account.title")}</h2>
      <p data-testid="signed-in">{t("account.as", { email: profile.email, region: profile.region })}</p>
      <p className="mute">{t("account.kept")}</p>
      <button onClick={signOut} data-testid="signout">{t("account.signout")}</button>
    </section>
  );
}

// --- Data: what the app fetched by itself, and the self-check (B3, B8). Nothing here has to be pressed. ----------
function Data({ t, release, data, check, sync, selfCheck, offline, onOpenFolder }) {
  const failed = check?.results?.find((c) => !c.ok);
  const p = data.progress;
  return (
    <section>
      <h2>{t("data.title")}</h2>
      <p data-testid="data-state">{release ? t("data.inHand", { asOf: release.manifest.as_of, id: release.release_id, runs: release.manifest.runs })
                                           : t(data.status === "fetching" ? "data.first" : "data.none")}</p>
      {data.status === "fetching" && <p className="mute" data-testid="data-progress">
        {p ? t("data.progress", { ...p, from: t(`data.from.${p.from}`) }) : t("data.fetching")}</p>}
      {data.status === "current" && <p className="good" data-testid="data-ok">{t(data.changed ? "data.updated" : "data.upToDate")}</p>}
      {data.status === "offline" && <p className="bad" data-testid="data-bad">{t("data.offline")}</p>}
      {data.status === "refused" && <p className="bad" data-testid="data-bad">{t("data.refused", { why: data.why })}</p>}
      {offline
        ? <button onClick={onOpenFolder} data-testid="data-folder">{t("data.loadFolder")}</button>
        : <button onClick={sync} disabled={data.status === "fetching"} data-testid="data-again">{t("data.again")}</button>
      }
      <h2>{t("check.title")}</h2>
      <p className="mute">{t("check.intro")}</p>
      <button onClick={selfCheck} disabled={!release} data-testid="check-run">{t("check.run")}</button>
      {check?.none && <p className="mute" data-testid="check-none">{t("check.none")}</p>}
      {check?.results && !failed && <p className="good" data-testid="check-pass">{t("check.pass", { n: check.results.length })}</p>}
      {failed && <p className="bad" data-testid="check-fail">{t("check.fail", {
        name: failed.name, figure: failed.differences[0].figure,
        computed: failed.differences[0].computed ?? failed.differences[0].said, expected: failed.differences[0].expected ?? "–" })}</p>}
    </section>
  );
}

// --- Portfolio: the accounts, what they may hold, the strategies, the weights (B4) -------------------------------
function Book({ t, f, core, book, setBook, pools, poolsError, catalogue, names, ccy, release, setNotice, country }) {
  const [types, setTypes] = useState([]);
  const [search, setSearch] = useState(""), [sleeve, setSleeve] = useState("");
  const file = useRef(null);
  useEffect(() => {
    if (release) core.current.call("account_types", { country: book.country }).then(setTypes).catch(() => setTypes([]));
  }, [book.country, release, core]);

  const acct = (i, patch) => setBook({ ...book, accounts: book.accounts.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  const addAcct = () => setBook({ ...book, accounts: [...book.accounts, { name: `${types[0]?.type ?? ""} ${book.accounts.length + 1}`.trim(), type: types[0]?.type ?? "", balance: 100000, usd: 0, fx_fee: 0 }] });
  const dropAcct = (i) => {
    const gone = book.accounts[i].name;
    setBook({ ...book, accounts: book.accounts.filter((_, k) => k !== i), collateral: book.collateral.filter((c) => c !== gone) });
  };
  const collateral = (name, on) => setBook({ ...book, collateral: on ? [...new Set([...book.collateral, name])] : book.collateral.filter((c) => c !== name) });
  const totals = pools ? poolTotals(book, pools) : {};
  const shown = catalogue.filter((r) => (!sleeve || r.sleeve === sleeve) && (!search || r.name.toLowerCase().includes(search.toLowerCase()))
                                    && (!pools || pools.pools.some((p) => p.sleeve === r.sleeve)));
  const add = (r, p) => setBook(setHolding(book, r.run_id, p.sleeve, p.lever, fromPool(0.1, p.sleeve, p.lever, pools)));

  const save = () => {
    const blob = new Blob([exportBook(book, release)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${book.name || "cupel"}.cupel-book.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const open = async (e) => {
    const text = await e.target.files[0]?.text();
    e.target.value = "";
    if (text == null) return;
    try { setBook(importBook(text)); setNotice(null); } catch (x) { setNotice(t(x.message)); }
  };

  return (
    <section>
      <h2>{t("book.title")}</h2>
      <div className="row">
        <label>{t("book.name")}<input value={book.name} onChange={(e) => setBook({ ...book, name: e.target.value })} data-testid="book-name" /></label>
        <label>{t("book.country")}
          <select value={book.country} onChange={(e) => setBook({ ...newBook(e.target.value), name: book.name })} data-testid="book-country">
            {/* a registered user's portfolios are their own country's (B9); before registration either may be tried */}
            {(country ? [country] : ["CA", "US"]).map((c) => <option key={c} value={c}>{t(`country.${c}`)}</option>)}
          </select></label>
        <button onClick={save} data-testid="book-export">{t("book.export")}</button>
        <button onClick={() => file.current.click()} data-testid="book-import">{t("book.import")}</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={open} data-testid="book-file" />
        <button onClick={() => setBook(newBook(book.country))}>{t("book.new")}</button>
      </div>

      <h3>{t("book.accounts")}</h3>
      <p className="mute">{t("book.accounts.intro")}</p>
      <table data-testid="accounts">
        <thead><tr><th>{t("acct.name")}</th><th>{t("acct.type")}</th><th>{t("acct.balance", { ccy })}</th>
          {book.country === "CA" && <th>{t("acct.usd", { ccy })}</th>}<th>{t("acct.collateral")}</th><th /></tr></thead>
        <tbody>
          {book.accounts.map((a, i) => (
            <tr key={i}>
              <td><input value={a.name} onChange={(e) => acct(i, { name: e.target.value })} data-testid={`acct-name-${i}`} /></td>
              <td><select value={a.type} onChange={(e) => acct(i, { type: e.target.value })} data-testid={`acct-type-${i}`}>
                {types.map((x) => <option key={x.type} value={x.type} title={x.note}>{x.type}</option>)}</select></td>
              <td><input type="number" min="0" value={a.balance} onChange={(e) => acct(i, { balance: Number(e.target.value) })} data-testid={`acct-balance-${i}`} /></td>
              {book.country === "CA" && <td><input type="number" min="0" value={a.usd ?? 0} onChange={(e) => acct(i, { usd: Number(e.target.value) })} data-testid={`acct-usd-${i}`} /></td>}
              <td><input type="checkbox" checked={book.collateral.includes(a.name)} onChange={(e) => collateral(a.name, e.target.checked)} data-testid={`acct-collateral-${i}`} /></td>
              <td><button onClick={() => dropAcct(i)}>{t("acct.remove")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addAcct} disabled={!types.length} data-testid="acct-add">{t("acct.add")}</button>

      <div className="row settings">
        <label>{t("book.buyingPower", { ccy })}<input type="number" min="0" value={book.buying_power} onChange={(e) => setBook({ ...book, buying_power: Number(e.target.value) })} data-testid="book-buying-power" /></label>
        <label>{t("book.margin")}
          <select value={book.margin} onChange={(e) => setBook({ ...book, margin: e.target.value })} data-testid="book-margin">
            <option value="off">{t("margin.off")}</option><option value="on">{t("margin.on")}</option></select></label>
        <label>{t("book.rebalance")}
          <select value={book.rebalance} onChange={(e) => setBook({ ...book, rebalance: e.target.value })}>
            {["M", "Q", "Y", "none"].map((r) => <option key={r} value={r}>{t(`rebalance.${r}`)}</option>)}</select></label>
        <label>{t("book.years")}<input type="number" min="1" max="60" value={book.years} onChange={(e) => setBook({ ...book, years: Number(e.target.value) })} /></label>
        <label>{t("book.ruin")}<input type="number" min="0" max="50" step="0.5" value={book.ruin * 100} onChange={(e) => setBook({ ...book, ruin: Number(e.target.value) / 100 })} /></label>
        <label>{t("book.inflation")}<input type="number" min="0" max="20" step="0.5" value={book.inflation * 100} onChange={(e) => setBook({ ...book, inflation: Number(e.target.value) / 100 })} /></label>
      </div>

      {poolsError && <p className="bad" data-testid="pools-error">{poolsError}</p>}
      {pools && (
        <>
          <h3>{t("book.pools")}</h3>
          <p className="mute" data-testid="capital">{t("pool.capital", { amount: f.money(pools.capital), ccy })}</p>
          <ul data-testid="pools">
            {pools.pools.map((p) => <li key={poolKey(p)}>{t("pool.row", { label: p.label, amount: f.money(p.amount), ccy, share: f.pct(p.share, 1) })}</li>)}
          </ul>

          <h3>{t("book.holdings")}</h3>
          {!book.holdings.length ? <p className="mute">{t("book.holdings.none")}</p> : (
            <table data-testid="holdings">
              <thead><tr><th>{t("hold.strategy")}</th><th>{t("hold.pool")}</th><th>{t("hold.weight")}</th><th /></tr></thead>
              <tbody>
                {book.holdings.map((h) => {
                  const p = pools.pools.find((x) => poolKey(x) === poolKey(h));
                  return (
                    <tr key={`${h.run}-${poolKey(h)}`}>
                      <td>{names.get(h.run)?.name ?? h.run}</td><td>{p?.label}</td>
                      <td><input type="number" min="0" step="1" value={Math.round(toPool(h, pools) * 10000) / 100}
                                 onChange={(e) => setBook(setHolding(book, h.run, h.sleeve, h.lever, fromPool(Number(e.target.value) / 100, h.sleeve, h.lever, pools)))}
                                 data-testid={`weight-${h.run}-${h.sleeve}-${h.lever ? 1 : 0}`} /></td>
                      <td><button onClick={() => setBook(setHolding(book, h.run, h.sleeve, h.lever, 0))}>{t("hold.remove")}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <ul className="mute" data-testid="pool-totals">
            {pools.pools.map((p) => {
              const x = totals[poolKey(p)] ?? 0;
              return <li key={poolKey(p)} className={x > 1 + 1e-9 && !p.lever ? "bad" : ""}>{t("hold.total", { label: p.label, pct: f.pct(x, 1) })}
                {x < 1 - 1e-9 ? ` (${t("hold.cash")})` : x > 1 + 1e-9 && !p.lever ? ` (${t("hold.over")})` : ""}</li>;
            })}
          </ul>

          <h3>{t("book.catalogue")}</h3>
          <p className="mute">{t("cat.gradeNote")}</p>
          <div className="row">
            <input placeholder={t("cat.search")} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="cat-search" />
            <label>{t("cat.sleeve")}
              <select value={sleeve} onChange={(e) => setSleeve(e.target.value)}>
                <option value="">{t("cat.all")}</option>{[...new Set(pools.pools.map((p) => p.sleeve))].map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          {!shown.length ? <p className="mute">{t("cat.none")}</p> : (
            <table data-testid="catalogue">
              <thead><tr><th>{t("cat.name")}</th><th>{t("cat.sleeve")}</th><th>{t("cat.grade")}</th><th className="n">{t("cat.cagr")}</th><th /></tr></thead>
              <tbody>
                {shown.slice(0, 200).map((r) => (
                  <tr key={r.run_id}>
                    <td>{r.name}</td><td>{r.sleeve}</td><td>{r.evidence ?? r.grade ?? "–"}</td><td className="n">{f.pct(r.cagr)}</td>
                    <td>{pools.pools.filter((p) => p.sleeve === r.sleeve && (!r.shorts || p.may_short)).map((p) => {
                      const has = book.holdings.some((h) => h.run === r.run_id && poolKey(h) === poolKey(p));
                      return <button key={poolKey(p)} disabled={has} onClick={() => add(r, p)} data-testid={`add-${r.run_id}-${p.sleeve}-${p.lever ? 1 : 0}`}>
                        {has ? t("cat.added") : `${t("cat.add")}: ${p.label}`}</button>;
                    })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

// --- Results: the book as entered, worked out (B4) ---------------------------------------------------------------
function Results({ t, f, book, pools, names, result, stale, evaluate, busy, ccy }) {
  const can = pools && book.holdings.length > 0;
  const r = result?.value;
  return (
    <section>
      <h2>{t("res.title")}</h2>
      <button onClick={evaluate} disabled={!can || busy} data-testid="evaluate">{t("res.evaluate")}</button>
      {!can && <p className="mute">{t("res.need")}</p>}
      {result?.error && <p className="bad" data-testid="result-error">{result.error}</p>}
      {stale && <p className="notice">{t("res.stale")}</p>}
      {r && (
        <div data-testid="result">
          <p className="mute">{t("res.asOf", { asOf: r.as_of, first: r.first_day, last: r.last_day, days: r.days })}</p>
          <p className="label">{t("res.label.hindsight")}</p>
          <p className="label">{t("res.label.scaling")}</p>
          {r.ruined ? <p className="bad" data-testid="ruined">{t("res.ruined", { day: r.ruined_on })}</p> : (
            <>
              <div className="tiles">
                {r.withdrawal != null && <Tile label={t("res.withdrawal")} value={f.pct(r.withdrawal)} testid="fig-withdrawal" raw={r.withdrawal}
                  sub={t("res.withdrawal.sub", { amount: f.money(r.withdrawal_amount), ccy, inflation: f.pct(r.monte_carlo.inflation, 1), years: r.monte_carlo.years, ruin: f.pct(r.monte_carlo.ruin, 0) })} />}
                {r.withdrawal != null && <Tile label={t("res.withdrawalFlat")} value={f.pct(r.withdrawal_flat)} />}
                <Tile label={t("res.cagr")} value={f.pct(r.cagr)} testid="fig-cagr" raw={r.cagr} />
                <Tile label={t("res.sortino")} value={f.num(r.sortino, 3)} />
                <Tile label={t("res.drawdown")} value={f.pct(r.max_drawdown)} sub={t("res.drawdown.sub", { from: r.worst_fall_from, to: r.worst_fall_to })} />
                <Tile label={t("res.underWater")} value={t("res.underWater.sub", { days: r.under_water_days, from: r.under_water_from })} />
                <Tile label={t("res.final")} value={`${f.money(r.final)} ${ccy}`} />
              </div>
              <h3>{t("res.breaks")}</h3>
              {r.breaks.length ? <ul className="bad" data-testid="breaks">{r.breaks.map((b, i) => <li key={i}>{b.what}</li>)}</ul>
                               : <p className="good" data-testid="no-breaks">{t("res.breaks.none")}</p>}
              {Object.entries(r.cash).map(([label, share]) => <p key={label} className="mute" data-testid="cash">{t("res.cash", { label, pct: f.pct(share, 1) })}</p>)}
              <h3>{t("res.curve", { ccy })}</h3>
              <Line days={r.curve.days} values={r.curve.equity} format={f.money} />
              {r.monte_carlo && (
                <>
                  <h3>{t("res.fan", { ccy })}</h3>
                  <Fan fan={r.monte_carlo.fan} format={f.money} />
                  <p className="mute">{t("res.fan.note", { paths: f.money(r.monte_carlo.paths) })}</p>
                </>
              )}
              {r.holdings && (
                <>
                  <h3>{t("res.holdings")}</h3>
                  <table data-testid="result-holdings">
                    <thead><tr><th>{t("hold.strategy")}</th><th>{t("hold.pool")}</th><th className="n">{t("res.adds")}</th>
                      <th className="n">{t("res.plus5")}</th><th className="n">{t("res.minus5")}</th></tr></thead>
                    <tbody>
                      {r.holdings.map((h, i) => (
                        <tr key={i}><td>{h.name}</td><td>{pools?.pools.find((p) => poolKey(p) === poolKey(h))?.label}</td>
                          <td className="n">{f.pct(h.adds, 3)}</td><td className="n">{f.pct(h.plus_5, 3)}</td><td className="n">{f.pct(h.minus_5, 3)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, sub, testid, raw }) {
  return <div className="tile" data-testid={testid} data-raw={raw}><div className="tl">{label}</div><div className="tv">{value}</div>{sub && <div className="ts">{sub}</div>}</div>;
}

// --- Optimize (B5): only in a build that has it switched on (src/lib/flags.js) -----------------------------------
function Optimize({ t, f, core, book, setBook, names, pools, said, setSaid, busy, setBusy }) {
  const [builder, setBuilder] = useState("withdrawal"), [maxdd, setMaxdd] = useState(25), [found, setFound] = useState(null), [error, setError] = useState(null);
  const runs = [...new Set(book.holdings.map((h) => h.run))];
  const go = async () => {
    setSaid([]); setFound(null); setError(null); setBusy(t("working"));
    try {
      setFound(await core.current.call("optimize", { book, builder, runs, starts: 3, max_dd: maxdd / 100 }));
    } catch (e) { if (e.message !== "stopped") setError(String(e.message)); } finally { setBusy(null); }
  };
  return (
    <section data-testid="optimizer">
      <h2>{t("opt.title")}</h2>
      <p className="mute">{t("opt.intro")}</p>
      <div className="row">
        <label>{t("opt.builder")}
          <select value={builder} onChange={(e) => setBuilder(e.target.value)} data-testid="opt-builder">
            {["withdrawal", "sortino", "cagr_dd", "equal"].map((b) => <option key={b} value={b}>{t(`builder.${b}`)}</option>)}</select></label>
        {builder === "cagr_dd" && <label>{t("opt.maxdd")}<input type="number" min="1" max="99" value={maxdd} onChange={(e) => setMaxdd(Number(e.target.value))} /></label>}
        <button onClick={go} disabled={!pools || runs.length < 2 || !!busy} data-testid="opt-run">{t("opt.run")}</button>
      </div>
      {runs.length < 2 && <p className="mute">{t("opt.need")}</p>}
      {said.length > 0 && <pre data-testid="opt-said">{said.join("\n")}</pre>}
      {error && <p className="bad" data-testid="opt-error">{error}</p>}
      {found && (
        <div data-testid="opt-found">
          {!found.feasible && <p className="bad">{t("opt.infeasible")}</p>}
          <p className="mute">{t("opt.note")}</p>
          <div className="tiles">
            <Tile label={t("res.withdrawal")} value={f.pct(found.evaluation.withdrawal)} testid="opt-withdrawal" raw={found.evaluation.withdrawal} />
            <Tile label={t("res.cagr")} value={f.pct(found.evaluation.cagr)} />
            <Tile label={t("res.drawdown")} value={f.pct(found.evaluation.max_drawdown)} />
          </div>
          <table><thead><tr><th>{t("hold.strategy")}</th><th>{t("hold.pool")}</th><th className="n">{t("hold.weight")}</th></tr></thead>
            <tbody>{found.holdings.map((h, i) => (
              <tr key={i}><td>{names.get(h.run)?.name ?? h.run}</td><td>{pools?.pools.find((p) => poolKey(p) === poolKey(h))?.label}</td>
                <td className="n">{f.pct(toPool(h, pools), 1)}</td></tr>))}</tbody></table>
          <button onClick={() => setBook({ ...book, holdings: found.holdings })} data-testid="opt-use">{t("opt.use")}</button>
        </div>
      )}
    </section>
  );
}
