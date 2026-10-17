# cupel-portfolios

A desktop portfolio tool for DIY investors. You enter your accounts, pick strategies from the catalogue, set weights, and the app works out the numbers — withdrawal rate, growth, drawdowns, Monte Carlo fan — on your own machine. Your balances and holdings are never sent anywhere.

Built on [Tauri 2](https://tauri.app) + React, with the calculations running in Python ([Pyodide](https://pyodide.org)) inside a Web Worker. English and French. Windows for now; macOS is not built.

---

## What it needs to run: data from cupel

The app does not include market data. To show strategies and evaluate portfolios it needs a **data release** — a set of parquet files containing strategy runs, equity curves, exchange rates and margin rates, bundled with a manifest.

There are two ways to get one:

### 1. Sign in with a cupel account

[Cupel](https://github.com/tverstraten/cupel) is the companion service that builds and publishes data releases. Sign in inside the app: your browser opens cupel's sign-in page, you approve the app there, and the app fetches the current release by itself. After that it checks for newer data each time it starts. No account credentials are typed into the app; nothing about your money reaches cupel.

### 2. Open a local data folder

If you have a data release as a folder of files (a `manifest.json` and the parts it names), click **Open data folder** on the sign-in screen. No cupel account is needed. The app loads the files, opens them in the Python core, and works exactly as it does on the API path.

A small sample release is included at `sample/` for testing and to show the expected layout.

---

## What the app does

| Screen | What it's for |
|--------|---------------|
| **Portfolio** | Enter accounts by type (RRSP, TFSA, margin, …), set balances, pick strategies from the catalogue, and set the weight of each holding in its account pool. Save and load portfolios as `.cupel-book.json` files. |
| **Results** | Work out the portfolio: annualised growth, worst fall, Sortino, sustainable withdrawal rate (with Monte Carlo), final balance, and a list of any rules broken. |
| **Optimize** *(optional build flag)* | Find the weights that best meet one aim — largest withdrawal, largest Sortino, largest growth within a drawdown cap, or equal weights. Runs on your machine; nothing leaves it. |
| **Data** | See the release in hand (date, number of runs), run the self-check (computed figures compared against the reference portfolios bundled in the release). |
| **Account** | Sign out. |

All computation happens locally in the Python core (Pyodide). The app stores its files at `%APPDATA%\ca.cupel.app`: profile, install token, the release, and saved portfolios.

---

## Getting started

### Prerequisites

| Tool | Version |
|------|---------|
| Node | 22 or later |
| Python | 3.12 or later (for the core tests and the `bundle-core` build step) |
| Rust / Cargo | stable (for Tauri — only needed if building the `.exe`) |

### Install dependencies

```
npm install
```

### Fetch the Pyodide runtime (once)

The Python runtime ships as a set of `.whl` and `.zip` files that the app serves from `public/pyodide/`. Download them once:

```
npm run runtime
```

This runs `scripts/fetch-pyodide.mjs` (downloads from the PyPI CDN) and `scripts/bundle-core.mjs` (copies the Python core into the bundle). Re-run when `package.json`'s `pyodide` version changes or when `core/` changes.

### Run in development (browser)

```
npm run dev
```

Opens the app in your default browser. Tauri is not involved: the store uses the browser's IndexedDB instead of the filesystem, and the browser's `fetch` instead of Tauri's. Sign in works the same way; **Open data folder** also works the same way.

### Build the Windows executable

```
npm run build:exe       # src-tauri/target/release/cupel.exe
```

The exe runs as a Tauri window (WebView2). It keeps its data at `%APPDATA%\ca.cupel.app` and uses the filesystem and Tauri's HTTP plugin instead of the browser APIs.

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
