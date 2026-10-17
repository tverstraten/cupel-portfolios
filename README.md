# cupel-portfolios

The user's application for [cupel](https://github.com/tverstraten/cupel): a Tauri 2 window over React screens that builds books of strategies — which strategies, in which sleeve and account, at what weight — on the user's own machine. The accounts and their money never leave it.

English and French. Windows for now; macOS is not built.

---

## What it does

- Connects to cupel's API to sign in and fetch strategy data (a data release: runs, equity curves, exchange rates).
- Models each account's type, holding and withdrawal rules, and tax drag: the income estimate you see is net of your marginal rate applied to each account's dividends and realized gains.
- Runs the optimization in a Web Worker under Pyodide — Python in the browser, on your own machine.
- Keeps everything in its own data folder (`%APPDATA%\ca.cupel.app`): profile, install token, releases, books.

A signed-in cupel account is for fetching data releases. A user who supplies their own data release may skip sign-in; the app does not require cupel registration to function.

---

## Building

Requires Node 22+, Python 3.12+, and the [Rust stable toolchain](https://rustup.rs) (for Tauri).

```
npm install
npm run runtime        # fetch Pyodide and its packages into public/pyodide/ (once)
npm run build:exe      # src-tauri/target/release/cupel.exe
```

### Tests

```
py -m pytest core/tests          # the core under CPython
node core/tests/run_pyodide.mjs  # the core under Pyodide (needs public/pyodide/)
npm test                         # the app's unit and policy tests
npm run test:e2e                 # the app's screens in Edge (needs the test build)
```

---

## The core (`core/`)

`core/cupel_core` is the one place a book is computed. It imports no database driver and reads no environment. It runs both here under Pyodide and in [cupel](https://github.com/tverstraten/cupel)'s server-side Python.

---

## The API

The app calls the routes documented in [`openapi.yaml`](openapi.yaml). The spec is **driven and published by cupel** (`tverstraten/cupel`, `web/api/openapi.yaml`, served at `GET /api/v1/openapi.yaml`). The copy here is fetched from cupel:

```
npm run fetch-spec   # requires cupel's web server to be up
```

The two addresses the app knows, fixed when it is built (`src/lib/flags.js`):
- The API's base (`VITE_CUPEL_API`, default `http://127.0.0.1:8814`)
- The site's address as a browser reaches it (`VITE_CUPEL_SITE`)

---

## Licence

The source is open. The commercial licence covers use for others' money, in a business, or to republish the output. See `TODO.md` in the cupel repository for the licence text (not yet drafted by counsel).
