// Verify that releaseFromFolder() produces the same {manifest, parts} as reading
// the sample/ directory directly — i.e. the flat-file path gives identical data
// to what the fixture() helper (which mirrors the API download path) gives.
// Also: open the same data via the API path and the folder path in the real pyodide
// core and confirm both produce an identical catalogue.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = path.join(APP, "sample");

// Load modules under test from the source tree (they use web APIs: TextDecoder, crypto — available in Node 20+)
const { releaseFromFolder } = await import(new URL("../src/lib/flatfile.js", import.meta.url).href);
const { checkManifest, update, readParts } = await import(new URL("../src/lib/release.js", import.meta.url).href);
const { memoryStore } = await import(new URL("../src/lib/store.js", import.meta.url).href);
const { fixture, fakeApi, startCore, EXPECTED } = await import(new URL("./helpers.mjs", import.meta.url).href);

// Build a mock FileList from a folder path so we can test the browser-API-based function
// in Node without a full DOM. Each entry carries the three properties releaseFromFolder reads.
function mockFileList(dir, folderName = "sample") {
  const files = [];
  function walk(sub) {
    for (const name of fs.readdirSync(sub, { withFileTypes: true })) {
      const full = path.join(sub, name.name);
      if (name.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(dir, full).replace(/\\/g, "/");
        const data = fs.readFileSync(full);
        files.push({
          webkitRelativePath: `${folderName}/${rel}`,
          text: () => Promise.resolve(data.toString("utf8")),
          arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
        });
      }
    }
  }
  walk(dir);
  return files;
}

describe("releaseFromFolder", () => {
  it("parses sample/ and produces a valid manifest", async () => {
    const fileList = mockFileList(SAMPLE);
    const { manifest } = await releaseFromFolder(fileList);
    assert.equal(manifest.format, 1);
    assert.ok(Number.isSafeInteger(manifest.release_id) && manifest.release_id > 0);
    assert.ok(Array.isArray(manifest.parts) && manifest.parts.length > 0);
    // checkManifest must not throw
    checkManifest(manifest);
  });

  it("returns every part listed in the manifest as a Uint8Array", async () => {
    const fileList = mockFileList(SAMPLE);
    const { manifest, parts } = await releaseFromFolder(fileList);
    for (const p of manifest.parts) {
      const bytes = parts.get(p.part);
      assert.ok(bytes instanceof Uint8Array, `part ${p.part} missing`);
      assert.ok(bytes.length > 0, `part ${p.part} is empty`);
    }
    assert.equal(parts.size, manifest.parts.length);
  });

  it("byte-matches the files on disk in sample/", async () => {
    const fileList = mockFileList(SAMPLE);
    const { manifest, parts } = await releaseFromFolder(fileList);
    for (const p of manifest.parts) {
      const actual = parts.get(p.part);
      const expected = new Uint8Array(fs.readFileSync(path.join(SAMPLE, p.part)));
      assert.deepEqual(actual, expected, `${p.part} differs from file on disk`);
    }
  });

  it("throws when manifest.json is absent", async () => {
    const fileList = mockFileList(SAMPLE).filter(
      (f) => !f.webkitRelativePath.endsWith("manifest.json")
    );
    await assert.rejects(
      () => releaseFromFolder(fileList),
      /manifest\.json/
    );
  });

  it("throws when a listed part is absent", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLE, "manifest.json"), "utf8"));
    const missingPart = manifest.parts[0].part;
    const fileList = mockFileList(SAMPLE).filter(
      (f) => !f.webkitRelativePath.endsWith(missingPart)
    );
    await assert.rejects(
      () => releaseFromFolder(fileList),
      new RegExp(missingPart.replace("/", "\\/"))
    );
  });
});

// Prove that API-loaded and folder-loaded releases give identical output from the core.
// Both paths end at core.openRelease(manifest, parquetParts) — this test shows they arrive there
// with the same manifest and the same bytes, and that the core accepts and reads both.
describe("API path vs folder path — core output", () => {
  let core;
  before(async () => { core = await startCore(); });

  it("catalogue from API path and folder path are identical", async () => {
    // API path: update() writes parts to a memoryStore from the fakeApi
    const fix = fixture();
    const store = memoryStore();
    const rel = await update(store, fakeApi(fix));
    const apiParts = new Map([...fix.parts].filter(([k]) => k.endsWith(".parquet")));
    core.openRelease(rel.manifest, apiParts);
    const catApi = core.call("catalogue");

    // Folder path: releaseFromFolder() on the same data (sample/ is a copy of core/tests/release/)
    const fileList = mockFileList(SAMPLE);
    const { manifest: folderManifest, parts: folderParts } = await releaseFromFolder(fileList);
    checkManifest(folderManifest);
    const folderParquetParts = new Map([...folderParts].filter(([k]) => k.endsWith(".parquet")));
    core.openRelease(folderManifest, folderParquetParts);
    const catFolder = core.call("catalogue");

    // Both catalogues must list the same runs in the same order
    assert.equal(catFolder.length, catApi.length, "catalogue length differs");
    for (let i = 0; i < catApi.length; i++) {
      assert.equal(catFolder[i].run_id, catApi[i].run_id, `run_id differs at index ${i}`);
      assert.equal(catFolder[i].name,   catApi[i].name,   `name differs at index ${i}`);
      assert.equal(catFolder[i].sleeve, catApi[i].sleeve, `sleeve differs at index ${i}`);
      assert.ok(Math.abs(catFolder[i].cagr - catApi[i].cagr) < 1e-12, `cagr differs at index ${i}`);
    }
  });
});

// Simulate the exact App.jsx openFromFolder + openRelease + selfCheck call sequence using
// memoryStore and the real pyodide core. Proves the folder path produces the same evaluated
// portfolio figures as the API path, and that selfCheck passes.
describe("openFromFolder flow: evaluate() and selfCheck identical to API path", () => {
  let core;
  before(async () => { core = await startCore(); });

  // Helper: write a {manifest, parts} object into a memoryStore the same way openFromFolder does.
  async function storeLocally(store, manifest, parts) {
    checkManifest(manifest);
    const id = manifest.release_id;
    for (const [name, bytes] of parts) {
      await store.writeBytes(`releases/${id}/${name}`, bytes);
    }
    await store.writeText(`releases/${id}/manifest.json`, JSON.stringify(manifest));
    await store.writeText("releases/current.json", JSON.stringify({ release_id: id, local: true }));
    return { release_id: id, manifest };
  }

  it("evaluate() results are numerically identical from API path and folder path", async () => {
    const book = EXPECTED.self_check[0].book;

    // API path: update() → readParts() → openRelease
    const fix = fixture();
    const apiStore = memoryStore();
    const apiRel = await update(apiStore, fakeApi(fix));
    const apiParts = await readParts(apiStore, apiRel);
    core.openRelease(apiRel.manifest, new Map([...apiParts].filter(([k]) => k.endsWith(".parquet"))));
    const apiResult = core.call("evaluate", { book });

    // Folder path: releaseFromFolder → storeLocally (mirrors openFromFolder) → readParts → openRelease
    const fileList = mockFileList(SAMPLE);
    const { manifest: fm, parts: fp } = await releaseFromFolder(fileList);
    const folderStore = memoryStore();
    const folderRel = await storeLocally(folderStore, fm, fp);
    const folderParts = await readParts(folderStore, folderRel);
    core.openRelease(folderRel.manifest, new Map([...folderParts].filter(([k]) => k.endsWith(".parquet"))));
    const folderResult = core.call("evaluate", { book });

    // Every numeric portfolio result must be identical to floating-point precision
    for (const f of ["withdrawal", "withdrawal_flat", "cagr", "sortino", "max_drawdown", "final"]) {
      assert.ok(
        Math.abs(apiResult[f] - folderResult[f]) < 1e-12,
        `${f}: API=${apiResult[f]}, folder=${folderResult[f]}`
      );
    }
  });

  it("selfCheck passes on the folder-loaded release", async () => {
    // Replicate the selfCheck() callback in App.jsx: read reference.json from store, run self_check
    const fileList = mockFileList(SAMPLE);
    const { manifest: fm, parts: fp } = await releaseFromFolder(fileList);
    const store = memoryStore();
    const rel = await storeLocally(store, fm, fp);
    const parts = await readParts(store, rel);
    core.openRelease(rel.manifest, new Map([...parts].filter(([k]) => k.endsWith(".parquet"))));

    const rawRef = await store.readBytes(`releases/${rel.release_id}/reference.json`);
    assert.ok(rawRef, "reference.json must be in the store after a folder load");
    const cases = JSON.parse(new TextDecoder().decode(rawRef));
    const results = core.call("self_check", { cases });
    const failed = results.filter((r) => !r.ok);
    assert.equal(failed.length, 0, `self_check failed: ${JSON.stringify(failed)}`);
  });
});

// Validate sample/manifest.json and sample/reference.json against release-schema.json.
// This confirms the schema describes the actual files in sample/, not just an aspirational spec.
describe("release-schema.json validates sample files", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(APP, "release-schema.json"), "utf8"));
  const PART_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/;
  const SHA256_PATTERN = /^[0-9a-f]{64}$/;

  it("sample/manifest.json has all required Manifest fields", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLE, "manifest.json"), "utf8"));
    for (const field of schema.$defs.Manifest.required) {
      assert.ok(field in manifest, `manifest.json missing required field: ${field}`);
    }
    assert.equal(manifest.format, 1, "format must be 1");
    assert.ok(Number.isSafeInteger(manifest.release_id) && manifest.release_id > 0);
    assert.ok(typeof manifest.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(manifest.as_of));
  });

  it("every part in sample/manifest.json is a valid Part entry and the file exists", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLE, "manifest.json"), "utf8"));
    for (const p of manifest.parts) {
      for (const field of schema.$defs.Part.required) {
        assert.ok(field in p, `part ${p.part ?? "?"} missing required field: ${field}`);
      }
      assert.ok(PART_PATTERN.test(p.part),   `part path "${p.part}" does not match schema pattern`);
      assert.ok(SHA256_PATTERN.test(p.sha256), `sha256 for "${p.part}" does not match schema pattern`);
      assert.ok(Number.isSafeInteger(p.bytes) && p.bytes >= 0);
      const full = path.join(SAMPLE, p.part);
      assert.ok(fs.existsSync(full), `sample/${p.part} listed in manifest but not on disk`);
      assert.equal(fs.statSync(full).size, p.bytes, `sample/${p.part} byte count differs from manifest`);
    }
  });

  it("sample/reference.json has all required ReferenceJson fields", () => {
    const refPath = path.join(SAMPLE, "reference.json");
    assert.ok(fs.existsSync(refPath), "sample/reference.json must exist");
    const reference = JSON.parse(fs.readFileSync(refPath, "utf8"));
    assert.ok(Array.isArray(reference) && reference.length > 0, "reference.json must be a non-empty array");
    const itemRequired = schema.$defs.ReferenceJson.items.required;
    for (const entry of reference) {
      for (const field of itemRequired) {
        assert.ok(field in entry, `reference entry missing required field: ${field}`);
      }
      assert.ok(typeof entry.book === "object" && entry.book !== null);
      assert.ok(typeof entry.expect === "object" && entry.expect !== null);
    }
  });
});

// Prove that update() re-verifies every part against the server's SHA-256 after a local import,
// rather than short-circuiting with the locally-stored data as if it were server-verified.
describe("update() after a local folder import", () => {
  it("does not short-circuit: still contacts the server and returns changed:true", async () => {
    const fix = fixture();
    const store = memoryStore();

    // Simulate what openFromFolder does: write parts + local:true in current.json
    const { manifest: folderManifest, parts: folderParts } = await releaseFromFolder(mockFileList(SAMPLE));
    const id = folderManifest.release_id;
    for (const [name, bytes] of folderParts) {
      await store.writeBytes(`releases/${id}/${name}`, bytes);
    }
    await store.writeText(`releases/${id}/manifest.json`, JSON.stringify(folderManifest));
    await store.writeText("releases/current.json", JSON.stringify({ release_id: id, local: true }));

    const api = fakeApi(fix);
    const rel = await update(store, api);

    // update() must have asked the server for the current manifest (not short-circuited)
    assert.ok(api.asked.includes("current"), "update() never asked the server for the current manifest");
    // The parts were kept (SHA-256 matched server's list) but the release is now server-verified
    assert.equal(rel.changed, true, "update() should return changed:true — not the early-return path");
    // current.json must no longer carry local:true
    const cur = JSON.parse(await store.readText("releases/current.json"));
    assert.equal(cur.local, undefined, "local flag should be cleared after server verification");
  });
});

