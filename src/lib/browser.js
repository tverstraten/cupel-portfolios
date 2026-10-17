// The person's own browser, opened on cupel's sign-in page (Todd, 2026-10-05: the user signs in, and nothing is
// typed into the app). The one thing the app ever opens outside itself, and only an address on cupel's own site:
// src/lib/api.js believes a sign-in's link only there, and the program's permissions
// (src-tauri/capabilities/default.json) let it open nothing else. Returns whether it was opened.
import { BROWSER } from "./flags.js";
import { inTauri } from "./store.js";

export async function openInBrowser(url) {
  if (!BROWSER) return false;
  try {
    if (inTauri()) await (await import("@tauri-apps/plugin-opener")).openUrl(url);
    else globalThis.open(url, "_blank", "noopener");
    return true;
  } catch {
    return false;                 // the link is on the screen: the person opens it themselves
  }
}
