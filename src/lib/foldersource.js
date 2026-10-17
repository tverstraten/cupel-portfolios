// Load a release from a browser folder selection into the store and open it on the core.
// Called by App.jsx's openFromFolder callback; also importable in Node tests (uses only web
// APIs and store/core interfaces, no React).
//
// Returns { rel, catalogue, selfCheckResults } where selfCheckResults is null when the
// release contains no reference.json.

import { checkManifest, readParts } from "./release.js";
import { releaseFromFolder } from "./flatfile.js";

export async function openFolderSource(store, core, fileList) {
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
  core.openRelease(manifest, parquetParts);
  const catalogue = core.call("catalogue");
  const rawRef = await store.readBytes(`releases/${id}/reference.json`);
  const selfCheckResults = rawRef
    ? core.call("self_check", { cases: JSON.parse(new TextDecoder().decode(rawRef)) })
    : null;
  return { rel, catalogue, selfCheckResults };
}
