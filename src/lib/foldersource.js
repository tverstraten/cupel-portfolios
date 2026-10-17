// Load a release from a browser folder selection into the store and (optionally) open it on
// the core.  Both halves are importable in Node tests (no React, only web APIs and store/core
// interfaces).
//
// storeFromFolder  – fast: parse, verify, write to store.  Returns { rel, parquetParts,
//                   selfCheckCases }.  No Python involved.
// openFolderSource – calls storeFromFolder then opens the release on the core and fetches the
//                   catalogue.  Used by Node tests that need the full pipeline in one call.

import { checkManifest, readParts } from "./release.js";
import { releaseFromFolder } from "./flatfile.js";

export async function storeFromFolder(store, fileList) {
  const { manifest, parts } = await releaseFromFolder(fileList);
  checkManifest(manifest);
  const id = manifest.release_id;
  for (const [name, bytes] of parts) {
    await store.writeBytes(`releases/${id}/${name}`, bytes);
  }
  await store.writeText(`releases/${id}/manifest.json`, JSON.stringify(manifest));
  await store.writeText("releases/current.json", JSON.stringify({ release_id: id, local: true }));
  const rel = { release_id: id, manifest };
  const stored = await readParts(store, rel);
  const parquetParts = new Map([...stored].filter(([k]) => k.endsWith(".parquet")));
  const rawRef = await store.readBytes(`releases/${id}/reference.json`);
  const selfCheckCases = rawRef ? JSON.parse(new TextDecoder().decode(rawRef)) : null;
  return { rel, parquetParts, selfCheckCases };
}

export async function openFolderSource(store, core, fileList) {
  const { rel, parquetParts, selfCheckCases } = await storeFromFolder(store, fileList);
  await core.openRelease(rel.manifest, parquetParts);
  const catalogue = await core.call("catalogue");
  return { rel, catalogue, selfCheckCases };
}
