// The data release on the user's machine (OPPORTUNITY-PLAN-APPS.md B3): downloaded from cupel's API, every part
// checked against the manifest's SHA-256, and made the release in hand only once all of it has verified. The one
// before is kept until then, so a download that fails or is interrupted leaves the app working, and the app works
// with no network from the release in hand.
//
// In the store (src/lib/store.js):
//   releases/current.json            {release_id}: the release in hand
//   releases/<id>/manifest.json      a release's manifest
//   releases/<id>/<part>             its parts, each written only after its checksum matched
// A part the release in hand already has, with the same SHA-256, is copied and not downloaded again: an update
// downloads the differences.

export class ReleaseError extends Error {}

export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const partPath = (id, part) => `releases/${id}/${part}`;

// A release's id and its parts' names become places in the store, and they come from outside (the API's manifest,
// or a file on disk). So they are held to what cupel writes before any of them is used as one: the id a whole
// number above zero, a part a name or folder/name of letters, digits, `.`, `_` and `-`, no part of it `.` or `..`,
// none named twice, none the manifest's own file. Anything else is refused whole: nothing is read, written or removed.
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export function checkManifest(manifest) {
  const id = manifest?.release_id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new ReleaseError("the release's id is not a whole number above zero: not used");
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) throw new ReleaseError("the release has no parts: not used");
  const seen = new Set();
  for (const p of manifest.parts) {
    const name = p?.part;
    const ok = typeof name === "string" && name.length <= 200 && name !== "manifest.json"
      && name.split("/").every((s) => SEGMENT.test(s) && !/^\.+$/.test(s));
    if (!ok) throw new ReleaseError(`the release names a part ${JSON.stringify(name)} that is not a file of a release: not used`);
    if (seen.has(name.toLowerCase())) throw new ReleaseError(`the release names the part ${name} twice: not used`);
    seen.add(name.toLowerCase());
    if (typeof p.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256) || !Number.isSafeInteger(p.bytes) || p.bytes < 0) {
      throw new ReleaseError(`the release gives no size or checksum for ${name}: not used`);
    }
  }
  return manifest;
}

// the release in hand: {release_id, manifest}, or null (also when what is on disk is not a release: fetched again)
export async function inHand(store) {
  const cur = await store.readText("releases/current.json");
  if (!cur) return null;
  try {
    const { release_id } = JSON.parse(cur);
    if (!Number.isSafeInteger(release_id) || release_id <= 0) return null;
    const m = await store.readText(`releases/${release_id}/manifest.json`);
    if (!m) return null;
    const manifest = checkManifest(JSON.parse(m));
    return manifest.release_id === release_id ? { release_id, manifest } : null;
  } catch {
    return null;
  }
}

// every part of the release in hand, read back and checked again: Map(part -> bytes). Throws ReleaseError when a
// part is missing or no longer matches (a damaged disk, a file changed by hand): the caller downloads again.
export async function readParts(store, release) {
  const out = new Map();
  for (const p of release.manifest.parts) {
    const bytes = await store.readBytes(partPath(release.release_id, p.part));
    if (!bytes) throw new ReleaseError(`${p.part} of release ${release.release_id} is not on this machine`);
    if ((await sha256Hex(bytes)) !== p.sha256) throw new ReleaseError(`${p.part} of release ${release.release_id} no longer matches its checksum`);
    out.set(p.part, bytes);
  }
  return out;
}

// The newest release from the API, made the one in hand. `api`: {current(), part(id, part)} (src/lib/api.js).
// `onProgress({done, total, bytes, part, from})`: after each part, `from` "kept" (already here and verified),
// "copied" (the release in hand has it) or "downloaded". Returns {release_id, manifest, changed}.
export async function update(store, api, onProgress = () => {}) {
  const manifest = checkManifest(await api.current());
  const id = manifest.release_id;
  const before = await inHand(store);
  if (before && before.release_id === id) {
    try {
      await readParts(store, before);
      return { ...before, changed: false };
    } catch {
      // the release in hand is damaged: fetched again below, part by part
    }
  }
  const old = new Map((before && before.release_id !== id ? before.manifest.parts : []).map((p) => [p.part, p.sha256]));
  let done = 0, bytes = 0;
  const total = manifest.parts.length;
  for (const p of manifest.parts) {
    const at = partPath(id, p.part);
    let from = "downloaded";
    let have = await store.readBytes(at);                       // left by a download that was interrupted
    if (have && (await sha256Hex(have)) === p.sha256) from = "kept";
    else {
      have = null;
      if (old.get(p.part) === p.sha256) {
        const prev = await store.readBytes(partPath(before.release_id, p.part));
        if (prev && (await sha256Hex(prev)) === p.sha256) { have = prev; from = "copied"; }
      }
      if (!have) {
        have = await api.part(id, p.part);
        if (have.length !== p.bytes) throw new ReleaseError(`${p.part} came as ${have.length} bytes and the release says ${p.bytes}: not kept`);
        if ((await sha256Hex(have)) !== p.sha256) throw new ReleaseError(`${p.part} does not match the release's checksum: not kept`);
      }
      await store.writeBytes(at, have);
    }
    done++; bytes += p.bytes;
    onProgress({ done, total, bytes, part: p.part, from });
  }
  await store.writeText(`releases/${id}/manifest.json`, JSON.stringify(manifest));
  // only now is it the release in hand; the one before goes after that
  await store.writeText("releases/current.json", JSON.stringify({ release_id: id }));
  if (before && before.release_id !== id) await store.removeDir(`releases/${before.release_id}`);
  return { release_id: id, manifest, changed: true };
}
