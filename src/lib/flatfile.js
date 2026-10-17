// Load a release from a folder selected with <input type="file" webkitdirectory>.
// Returns {manifest, parts: Map<part-path, Uint8Array>} ready to pass to storeRelease() + openRelease().
// Throws with a user-readable message when the folder is not a valid release.

export async function releaseFromFolder(fileList) {
  const byPath = new Map();
  for (const file of fileList) {
    // webkitRelativePath is "<selected-folder-name>/..." — strip the leading segment
    const rel = file.webkitRelativePath.replace(/^[^/]+\//, "");
    if (rel) byPath.set(rel, file);
  }

  const manifestFile = byPath.get("manifest.json");
  if (!manifestFile) throw new Error("no manifest.json found in the selected folder");

  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.text());
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) {
    throw new Error("manifest.json lists no parts");
  }

  const parts = new Map();
  for (const p of manifest.parts) {
    const file = byPath.get(p.part);
    if (!file) throw new Error(`the manifest lists ${p.part} but the folder has no such file`);
    parts.set(p.part, new Uint8Array(await file.arrayBuffer()));
  }

  return { manifest, parts };
}
