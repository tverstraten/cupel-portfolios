// Fetch the app's API spec from cupel's web server and write openapi.yaml.
// The spec is maintained in tverstraten/cupel (web/api/openapi.yaml) and
// published at GET /api/v1/openapi.yaml. Run this after starting cupel's
// web server (npm run start in cupel/web/) to bring openapi.yaml up to date.
//
//   npm run fetch-spec
//   VITE_CUPEL_API=http://myserver npm run fetch-spec
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "openapi.yaml");

const base = (process.env.VITE_CUPEL_API ?? "http://127.0.0.1:8814").replace(/\/+$/, "");
const url = `${base}/api/v1/openapi.yaml`;
console.log(`fetching ${url} ...`);
let r;
try {
  r = await fetch(url);
} catch (e) {
  console.error(`could not reach cupel at ${url}: ${e.message ?? e}`);
  console.error("Start cupel's web server (cd cupel/web && npm run start) and try again.");
  process.exit(1);
}
if (!r.ok) {
  console.error(`cupel answered ${r.status} for ${url}`);
  process.exit(1);
}
const text = await r.text();
fs.writeFileSync(OUT, text, "utf8");
console.log(`wrote openapi.yaml (${text.length.toLocaleString()} bytes)`);
