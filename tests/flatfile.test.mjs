// Verify that the flat-file data source works end-to-end:
//   releaseFromFolder() parses a folder of files,
//   openFolderSource() (the function App.jsx imports from src/lib/foldersource.js) stores them,
//   opens them on the real pyodide core, and produces results identical to the API path.
// Also validates sample/manifest.json and sample/reference.json against release-schema.json
// using Python's jsonschema.Draft202012Validator.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = path.join(APP, "sample");

// Modules under test (use web APIs — TextDecoder, crypto — available in Node 20+)
const { releaseFromFolder } = await import(new URL("../src/lib/flatfile.js", import.meta.url).href);
const { checkManifest, update, readParts } = await import(new URL("../src/lib/release.js", import.meta.url).href);
const { memoryStore } = await import(new URL("../src/lib/store.js", import.meta.url).href);
// openFolderSource is the actual function App.jsx imports; the test calls the same exported function.
const { openFolderSource } = await import(new URL("../src/lib/foldersource.js", import.meta.url).href);
const { fixture, fakeApi, startCore, EXPECTED } = await import(new URL("./helpers.mjs", import.meta.url).href);

// Build a mock FileList from a folder path so we can test the browser File API in Node without a DOM.
function mockFileList(dir, folderName = "sample") {
  const files = [];
  function walk(sub) {
    for (const entry of fs.readdirSync(sub, { withFileTypes: true })) {
      const full = path.join(sub, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const rel = path.relative(dir, full).replace(/\\/g, "/");
      const data = fs.readFileSync(full);
      files.push({
        webkitRelativePath: `${folderName}/${rel}`,
        text: () => Promise.resolve(data.toString("utf8")),
        arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
      });
    }
  }
  walk(dir);
  return files;
}

// ── releaseFromFolder unit tests ──────────────────────────────────────────────

describe("releaseFromFolder", () => {
  it("parses sample/ and produces a valid manifest", async () => {
    const { manifest } = await releaseFromFolder(mockFileList(SAMPLE));
    assert.equal(manifest.format, 1);
    assert.ok(Number.isSafeInteger(manifest.release_id) && manifest.release_id > 0);
    assert.ok(Array.isArray(manifest.parts) && manifest.parts.length > 0);
    checkManifest(manifest);
  });

  it("returns every part listed in the manifest as a Uint8Array", async () => {
    const { manifest, parts } = await releaseFromFolder(mockFileList(SAMPLE));
    for (const p of manifest.parts) {
      const bytes = parts.get(p.part);
      assert.ok(bytes instanceof Uint8Array, `part ${p.part} missing`);
      assert.ok(bytes.length > 0, `part ${p.part} is empty`);
    }
    assert.equal(parts.size, manifest.parts.length);
  });

  it("byte-matches the files on disk in sample/", async () => {
    const { manifest, parts } = await releaseFromFolder(mockFileList(SAMPLE));
    for (const p of manifest.parts) {
      const actual = parts.get(p.part);
      const expected = new Uint8Array(fs.readFileSync(path.join(SAMPLE, p.part)));
      assert.deepEqual(actual, expected, `${p.part} differs from file on disk`);
    }
  });

  it("throws when manifest.json is absent", async () => {
    const fileList = mockFileList(SAMPLE).filter((f) => !f.webkitRelativePath.endsWith("manifest.json"));
    await assert.rejects(() => releaseFromFolder(fileList), /manifest\.json/);
  });

  it("throws when a listed part is absent", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLE, "manifest.json"), "utf8"));
    const missingPart = manifest.parts[0].part;
    const fileList = mockFileList(SAMPLE).filter((f) => !f.webkitRelativePath.endsWith(missingPart));
    await assert.rejects(() => releaseFromFolder(fileList), new RegExp(missingPart.replace("/", "\\/")));
  });
});

// ── openFolderSource: the function App.jsx actually calls ─────────────────────
// These tests call openFolderSource from src/lib/foldersource.js directly — the
// same exported function that App.jsx imports.  Proves the folder path produces
// results identical to the API path for catalogue, evaluate(), and selfCheck.

describe("openFolderSource (src/lib/foldersource.js) — API-path parity", () => {
  let core;
  before(async () => { core = await startCore(); });

  it("catalogue from openFolderSource equals catalogue from the API path", async () => {
    // API path: update() downloads the release from fakeApi and opens it on the core
    const fix = fixture();
    const apiStore = memoryStore();
    const apiRel = await update(apiStore, fakeApi(fix));
    const apiParts = new Map([...fix.parts].filter(([k]) => k.endsWith(".parquet")));
    core.openRelease(apiRel.manifest, apiParts);
    const catApi = core.call("catalogue");

    // Folder path: openFolderSource (what App.jsx calls on "Open data folder")
    const { catalogue: catFolder } = await openFolderSource(memoryStore(), core, mockFileList(SAMPLE));

    assert.equal(catFolder.length, catApi.length, "catalogue length differs");
    for (let i = 0; i < catApi.length; i++) {
      assert.equal(catFolder[i].run_id, catApi[i].run_id, `run_id[${i}]`);
      assert.equal(catFolder[i].name,   catApi[i].name,   `name[${i}]`);
      assert.equal(catFolder[i].sleeve, catApi[i].sleeve, `sleeve[${i}]`);
      assert.ok(Math.abs(catFolder[i].cagr - catApi[i].cagr) < 1e-12, `cagr[${i}]`);
    }
  });

  it("evaluate() figures from openFolderSource are numerically identical to the API path", async () => {
    const book = EXPECTED.self_check[0].book;

    // API path
    const fix = fixture();
    const apiStore = memoryStore();
    const apiRel = await update(apiStore, fakeApi(fix));
    const apiParts = await readParts(apiStore, apiRel);
    core.openRelease(apiRel.manifest, new Map([...apiParts].filter(([k]) => k.endsWith(".parquet"))));
    const apiResult = core.call("evaluate", { book });

    // Folder path via openFolderSource (the actual App.jsx function)
    await openFolderSource(memoryStore(), core, mockFileList(SAMPLE));
    const folderResult = core.call("evaluate", { book });

    for (const f of ["withdrawal", "withdrawal_flat", "cagr", "sortino", "max_drawdown", "final"]) {
      assert.ok(
        Math.abs(apiResult[f] - folderResult[f]) < 1e-12,
        `${f}: API=${apiResult[f]}, folder=${folderResult[f]}`
      );
    }
  });

  it("selfCheck passes on the folder-loaded release (openFolderSource returns results)", async () => {
    // openFolderSource reads reference.json from the store and runs core self_check internally
    const { selfCheckResults } = await openFolderSource(memoryStore(), core, mockFileList(SAMPLE));
    assert.ok(selfCheckResults !== null, "reference.json must produce selfCheck results");
    const failed = selfCheckResults.filter((r) => !r.ok);
    assert.equal(failed.length, 0, `self_check failed: ${JSON.stringify(failed)}`);
  });
});

// ── release-schema.json — validated with jsonschema.Draft202012Validator ───────
// tests/validate-schema.py uses Python's jsonschema library to check sample files
// against the full JSON Schema 2020-12 specification in release-schema.json.

describe("release-schema.json validates sample files (Draft202012Validator)", () => {
  it("sample/manifest.json and sample/reference.json pass jsonschema Draft202012Validator", () => {
    execFileSync("python", ["-I", path.join(APP, "tests", "validate-schema.py")], {
      cwd: APP,
      stdio: "pipe",
      encoding: "utf8",
    });
  });
});

// ── update() — local-flag guard ───────────────────────────────────────────────

describe("update() after a local folder import", () => {
  it("does not short-circuit: contacts the server and returns changed:true", async () => {
    // Use openFolderSource (the actual App.jsx function) to populate the store as a local release
    const store = memoryStore();
    const stubCore = { openRelease: () => {}, call: () => [] };
    await openFolderSource(store, stubCore, mockFileList(SAMPLE));

    const fix = fixture();
    const api = fakeApi(fix);
    const rel = await update(store, api);

    assert.ok(api.asked.includes("current"), "update() never contacted the server");
    assert.equal(rel.changed, true, "update() should return changed:true after a local import");
    const cur = JSON.parse(await store.readText("releases/current.json"));
    assert.equal(cur.local, undefined, "local flag must be cleared after server verification");
  });
});
