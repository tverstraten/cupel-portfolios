# cupel-portfolios

A desktop portfolio tool for DIY investors. You enter your accounts, pick strategies from the catalogue, set weights, and the app works out the numbers — withdrawal rate, growth, drawdowns, Monte Carlo fan — on your own machine. Your balances and holdings are never sent anywhere.

Built on [Tauri 2](https://tauri.app) + React, with the calculations running in Python ([Pyodide](https://pyodide.org)) inside a Web Worker. English and French. Windows (NSIS installer) and macOS (DMG).

---

## Why would I use this?

A DIY investor managing their own accounts faces a problem that spreadsheets handle badly and that wealth-management software either doesn't expose or locks behind a fee: **how do I know whether my current holdings, across all my accounts, are actually working — and will they last?**

This app answers a concrete version of that question.

### Withdrawal sustainability

The central number is **sustainable withdrawal rate**: what annual percentage of your portfolio can you take out, starting now, and still expect the portfolio to outlast you? The simulation draws from the portfolio's own historical monthly returns — not a generic capital-market assumption — and shows a fan of outcomes at the 5th, 25th, 50th, 75th, and 95th percentiles over a 30-year horizon. The 5th-percentile line is the pessimistic case; the 50th is the median. If your actual withdrawal rate is above the 5th-percentile fan at year 30, you're taking on meaningful sequence-of-returns risk.

### Historical performance

For each strategy in your portfolio the app shows the full history available in the data release:

- **CAGR** — compound annual growth rate over the strategy's run
- **Sortino ratio** — risk-adjusted return that penalises downside volatility only
- **Maximum drawdown** — the deepest peak-to-trough fall on record, as a percentage
- **Underwater days** — how long the longest recovery took
- **Equity curve** — a chart of the cumulative return over time

These are not simulated projections. They are the actual historical returns of the strategies in the data release.

### Account-type rules

Canadian registered accounts have legal constraints. The app knows them:

- **RRSP / RRIF / LIRA** — no short positions, no borrowing
- **TFSA** — same restrictions
- **Margin** — can hold short positions, can borrow, attracts tax on dividends and realised gains

If any holding in your book violates the rules for its account type, the Results screen lists the broken rules by account.

### Multi-account, tax-aware weighting

Your portfolio is modelled as a set of pools. Each pool belongs to an account type, and each account type has its own tax treatment of dividends and realised gains. The aggregate result accounts for the drag across all your pools. You can hold strategies in multiple pools and set weights per pool independently.

### Finding the right weights

Once you have picked your strategies, the allocation problem remains: what percentage of each pool should go in each strategy? Tweaking weights by hand and re-evaluating is tedious and biased toward what looks good historically in isolation. The optional Optimize screen solves this systematically — it searches the weight space to find the allocation that actually maximises whichever outcome you care about (withdrawal rate, Sortino, CAGR within a drawdown cap, or equal weights as a neutral baseline). The search runs locally in the Python core; results come back as a revised book you can review and save.

### Privacy

The app runs entirely on your machine. Python runs in a WebAssembly sandbox (Pyodide). The only outbound calls are to the cupel API to fetch a data release (if you sign in with a cupel account) and to cupel's sign-in page. **Nothing about your balances, account types, holdings, weights, or results is sent anywhere, ever.**

You can run the app with no network connection at all by supplying a local data folder instead of signing in.

---

## What it needs to run: data from cupel

The app does not include market data. To show strategies and evaluate portfolios it needs a **data release** — a set of parquet files containing strategy runs, equity curves, exchange rates and margin rates, bundled with a manifest.

Two ways to get one:

### 1. Sign in with a cupel account

[Cupel](https://github.com/tverstraten/cupel) is the companion service that produces the strategy data. A cupel account is what gives you API access to that data. Sign in inside the app: your browser opens cupel's sign-in page, you approve the app there, and the app can then retrieve the current release from the API. It checks for newer data each time it starts. No account credentials are typed into the app; nothing about your money reaches cupel.

### 2. Open a local data folder

If you have a data release as a folder of files (a `manifest.json` and the parts it names), click **Open data folder** on the sign-in screen. No cupel account is needed. The app loads the files, opens them in the Python core, and works exactly as it does on the API path.

A small sample release is included at `sample/` for testing and to show the expected layout.

---

## What the app does

### Portfolio screen

<!-- Screenshot: docs/screenshots/portfolio.png — the book tab showing two accounts, the strategy catalogue on the right, and holdings with weights set. Run `npm run dev` and open a sample book to capture this. -->

The Portfolio screen is your book editor. Everything you enter here is stored in a `.cupel-book.json` file on your machine; nothing is sent to a server.

**Accounts and pools.** Add one entry per account (e.g. "RRSP at TD", "TFSA at Questrade", "Non-registered margin"). Assign each a type (RRSP, TFSA, RRIF, LIRA, PRSP, margin, or RESP); the type determines which account-level rules apply and how the Python core models tax drag on that pool.

**The strategy catalogue.** The right panel lists every strategy in the data release — each strategy is a set of holdings (equities, ETFs, or synthetics) with a defined rebalancing rule and a full historical run. Pick any strategy and assign it to an account pool at a weight (e.g., 30% of the TFSA pool in this strategy).

**Weights.** Within each account you assign percentage weights to strategies. The weights within a pool must sum to 100%. The pool balance is set on the account; the Python core allocates the balance across strategies by weight before evaluating the combined result.

**Save and load.** The toolbar has **Save book** and **Open book** buttons. Books are plain JSON files (`*.cupel-book.json`) you can version-control or share.

---

### Results screen

<!-- Screenshot: docs/screenshots/results.png — results tab showing withdrawal rate, Monte Carlo fan, equity curve, and a holdings table with per-strategy contributions. Run `npm run dev`, open a book with a few strategies, click Evaluate. -->

Click **Evaluate** (or it runs automatically after loading a book) to send your portfolio configuration to the Python core. The core runs entirely on your machine; results appear in seconds.

**Summary tiles**

| Metric | What it tells you |
|--------|------------------|
| Withdrawal rate | The annual percentage of your starting balance you can take out and still, at the median, have money left after 30 years. The number in the tile is the 50th-percentile result. |
| Final balance | Median portfolio value at year 30, as a multiple of the starting balance. |
| CAGR | Compound annual growth rate of the combined portfolio over the history in the release. |
| Sortino | Downside-risk-adjusted return. Higher is better; 1.0 is roughly market-average risk-adjusted performance. |
| Max drawdown | The worst peak-to-trough loss on record. |
| Underwater | The number of calendar days spent below the previous peak during the worst drawdown. |

**Monte Carlo fan.** A chart showing the distribution of 30-year outcomes. The five lines are the 5th, 25th, 50th, 75th, and 95th percentiles. The simulation resamples the portfolio's own historical monthly returns. A fan where the 5th-percentile line stays above zero at year 30 means the portfolio has never, historically, produced a sequence of returns that would exhaust the balance at your withdrawal rate. A fan where the 5th-percentile line crosses zero before year 30 means some historical sequences would.

**Equity curve.** The combined portfolio's historical cumulative return — what $1 invested in this mix at the start of the data history would be worth over time.

**Holdings table.** Per-strategy breakdown showing each strategy's weight, its individual CAGR and Sortino, and its contribution to the combined portfolio's return and risk. Lets you see which strategies are doing the work and which are dragging.

**Rules broken.** If any account holds a strategy that violates that account type's rules (e.g., a short position in a TFSA), the broken rules are listed here by account name.

---

### Optimize screen *(optional — build flag `VITE_CUPEL_OPTIMIZER=on`)*

Once you have picked your strategies, the question becomes: how much of each pool should go in each one? Adjusting weights by hand and re-evaluating is slow and tends to converge on what looked good in isolation rather than what actually works in combination. The Optimize screen automates this search.

It finds the holding weights that best achieve one goal, subject to the constraint that all weights remain non-negative and sum to 100% within each pool.

**Four objectives:**

| Mode | What it maximises |
|------|------------------|
| Max withdrawal | The 50th-percentile sustainable annual withdrawal rate — the most relevant objective for a retiree drawing income |
| Max Sortino | Risk-adjusted return, penalising downside volatility — good when capital preservation matters as much as growth |
| Max CAGR, capped drawdown | Compound annual growth, subject to a maximum-drawdown constraint you set — useful when you have a specific loss tolerance |
| Equal weights | Sets all weights to 1/N within each pool — a neutral sanity baseline to compare the optimised result against |

The search runs entirely on your machine in the Python core. For a book with many strategies across multiple pools it can take a few minutes. When it finishes, the results are written back into the Portfolio screen as revised weights; you can inspect, adjust, and save the book.

The build flag means the screen is off by default. Enable it:

```sh
VITE_CUPEL_OPTIMIZER=on npm run dev
# or, for the exe:
VITE_CUPEL_OPTIMIZER=on npm run build:exe
```

---

### Data screen

**Current release.** Shows the release in hand: the data end date, the number of strategy runs, and the release ID. Confirms each part's SHA-256 checksum was verified on load.

**Self-check.** The data release optionally includes a `reference.json` — a set of reference portfolios with pre-computed results. When present, the self-check re-evaluates those portfolios and compares the results to the reference values. A pass means the Python core on your machine, running against the parquet data, produces the same numbers as the server that produced the release. This is a data integrity guarantee, not a performance benchmark. The sample release includes two reference portfolios.

**Re-open folder.** If you loaded a local data folder, you can load a new folder from here to switch releases without restarting.

---

### Account screen

Shows the signed-in profile (email and region) and a **Sign out** button. In offline mode (local folder, no sign-in) it shows an "Offline" indicator. Sign-out clears the stored profile and install token; it does not clear the cached release or saved books.

---

## Getting started

### Download and run (no build required)

Pre-built installers are published with each release on the [Releases page](../../releases). No Node, Python, or Rust required.

- **Windows** — download `cupel-windows.exe` and run it
- **macOS** — download `cupel-macos.dmg`, open it, and drag Cupel to Applications. On first launch, right-click the app and choose **Open** to bypass Gatekeeper (the builds are unsigned)

To try it without a cupel account, click **Open data folder** on the sign-in screen and select the `sample/` folder from this repository.

The rest of this section is for contributors and anyone who wants to run from source or modify the code.

---

### Run from source

#### Prerequisites

| Tool | Version |
|------|---------|
| Node | 22 or later |
| Python | 3.12 or later (for core tests and the `bundle-core` build step) |
| Rust / Cargo | stable (for Tauri — only needed if building the `.exe`) |

#### Install dependencies

```
npm install
```

#### Fetch the Pyodide runtime (once)

The Python runtime ships as a set of `.whl` and `.zip` files that the app serves from `public/pyodide/`. Download them once:

```
npm run runtime
```

This runs `scripts/fetch-pyodide.mjs` (downloads from the PyPI CDN) and `scripts/bundle-core.mjs` (copies the Python core into the bundle). Re-run when `package.json`'s `pyodide` version changes or when `core/` changes.

#### Run in development (browser)

```
npm run dev
```

Opens the app in your default browser. Tauri is not involved: the store uses the browser's IndexedDB instead of the filesystem, and the browser's `fetch` instead of Tauri's. Sign in works the same way; **Open data folder** also works the same way.

#### Build the Windows executable

```
npm run build:exe       # src-tauri/target/release/cupel.exe
```

The exe runs as a Tauri window (WebView2) and keeps its data at `%APPDATA%\ca.cupel.app`.

#### Build the macOS DMG (run this on a Mac)

```
npm run build:dmg       # src-tauri/target/release/bundle/dmg/Cupel_x.y.z_aarch64.dmg
```

Tauri automatically picks up `src-tauri/tauri.macos.conf.json` on macOS, which sets the `dmg` bundle target and a minimum OS version of 10.15. The build is unsigned; users right-click → Open on first launch to bypass Gatekeeper. The app keeps its data at `~/Library/Application Support/ca.cupel.app`.

---

## Using a local data folder (no cupel account needed)

1. Obtain or produce a release folder. The expected layout is:

   ```
   my-release/
     manifest.json
     runs.parquet
     equity/
       <id-range>.parquet   (one or more equity curve files)
     fx.parquet
     margin_rate.parquet
     reference.json          (optional; enables self-check)
   ```

   The `sample/` folder in this repository is a minimal example (8 strategy runs, data as of 2025-12-31).

2. Start the app. On the sign-in screen, click **Open data folder** and select the folder.

3. The app loads the release, switches to the Portfolio tab, and runs the self-check in the background.

The release folder can be re-opened at any time from the **Data** screen. Each load re-verifies every part against the SHA-256 checksums in `manifest.json`.

### Data release format

`manifest.json` fields:

| Field | Type | Meaning |
|-------|------|---------|
| `format` | integer | Schema version (currently `1`) |
| `release_id` | integer | Unique release identifier |
| `as_of` | string | Data end date (`YYYY-MM-DD`) |
| `runs` | integer | Number of strategy runs |
| `parts` | array | Each part: `{ part, sha256, bytes }` |

The schema is validated by `release-schema.json` (JSON Schema 2020-12).

---

## Tests

```sh
# Python core under CPython
py -m pytest core/tests

# Python core under Pyodide (needs public/pyodide/)
node core/tests/run_pyodide.mjs

# App unit and policy tests (release.js, book.js, strings, …)
npm test

# Flat-file and folder-open integration (real Pyodide, no browser)
node --test tests/flatfile.test.mjs

# End-to-end in headless Edge (builds app, spins up fake API, runs all screens)
npm run test:e2e
```

The E2E suite covers: sign-in, data fetch, portfolio entry, results, optimizer (flag-gated build), persistence across restarts, damaged-release recovery, and opening a local data folder without signing in.

---

## Architecture

```
src/
  App.jsx                  React component tree (screens, state)
  lib/
    api.js                 HTTP calls to cupel's API
    core.js                Worker client (browser) — async postMessage
    corehost.js            Worker host (Node) — synchronous, used by tests
    foldersource.js        storeFromFolder + openFolderSource (no React)
    flatfile.js            releaseFromFolder: FileList → {manifest, parts}
    release.js             SHA-256 verification, update() download
    store.js               One interface, three backends: Tauri FS / IndexedDB / memory
    flags.js               Build-time feature flags (VITE_CUPEL_*)
    strings.js             All UI text (en / fr)
  worker/
    core.worker.js         Web Worker entry: Pyodide + cupel_core
core/
  cupel_core/              Python package: evaluate, optimize, self_check
  tests/                   pytest tests; Pyodide smoke test
sample/                    Minimal data release for testing
tests/
  e2e/                     Playwright E2E tests
  helpers.mjs              Shared test helpers
  flatfile.test.mjs        Folder-open parity tests (API path vs folder path)
  *.test.mjs               Unit tests
```

The Python core (`cupel_core`) runs unchanged under CPython (server-side) and under Pyodide (browser/desktop). It takes arrays and settings; it never queries a database or reads the filesystem directly.

---

## Building against a self-hosted cupel instance

The two addresses the app encodes at build time (`src/lib/flags.js`):

| Variable | Default | Meaning |
|----------|---------|---------|
| `VITE_CUPEL_API` | `http://127.0.0.1:8814` | API base URL |
| `VITE_CUPEL_SITE` | `http://localhost:8814` | Site address the sign-in page is on |

Pass them as environment variables when building:

```sh
VITE_CUPEL_API=https://your.cupel.host VITE_CUPEL_SITE=https://your.cupel.host npm run build:exe
```

The API routes the app calls are documented in [`openapi.yaml`](openapi.yaml). The spec is the authoritative copy from `tverstraten/cupel` and can be refreshed with `npm run fetch-spec` when cupel's server is running.

---

## Optional build flags

| Variable | Value | Effect |
|----------|-------|--------|
| `VITE_CUPEL_OPTIMIZER` | `on` | Enables the Optimize screen |
| `VITE_CUPEL_REFERRAL` | `on` | Enables the referral/adviser screen (not yet in use) |
| `VITE_CUPEL_BROWSER` | `off` | Disables auto-opening the sign-in URL (used by the test exe) |

---

## Licence

The source is open. The commercial licence covers use for others' money, in a business, or to republish the output. See `TODO.md` in the cupel repository for the licence text (not yet drafted by counsel).
