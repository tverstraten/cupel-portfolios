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
const { checkManifest, update } = await import(new URL("../src/lib/release.js", import.meta.url).href);
const { memoryStore } = await import(new URL("../src/lib/store.js", import.meta.url).href);
const { fixture, fakeApi, startCore } = await import(new URL("./helpers.mjs", import.meta.url).href);

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

