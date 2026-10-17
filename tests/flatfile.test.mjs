// Verify that releaseFromFolder() produces the same {manifest, parts} as reading
// the sample/ directory directly — i.e. the flat-file path gives identical data
// to what the fixture() helper (which mirrors the API download path) gives.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = path.join(APP, "sample");

// Load modules under test from the source tree (they use web APIs: TextDecoder, crypto — available in Node 20+)
const { releaseFromFolder } = await import(
  new URL("../src/lib/flatfile.js", import.meta.url).href
);
const { checkManifest } = await import(
  new URL("../src/lib/release.js", import.meta.url).href
);

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
