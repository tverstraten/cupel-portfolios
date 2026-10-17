// Fetch the app's API spec from cupel and write openapi.yaml.
// The spec is maintained in tverstraten/cupel (web/api/openapi.yaml) and
// published at GET /api/v1/openapi.yaml. This script tries two sources:
//
//   1. The peer checkout at ../cupel/web/api/openapi.yaml (works without
//      a running server; used in local development when both repos are checked out)
//   2. The running cupel server at VITE_CUPEL_API/api/v1/openapi.yaml
//
//   npm run fetch-spec
//   VITE_CUPEL_API=http://myserver npm run fetch-spec
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "openapi.yaml");

// source 1: peer checkout on disk
const PEER = path.resolve(ROOT, "..", "cupel", "web", "api", "openapi.yaml");
if (fs.existsSync(PEER)) {
  const text = fs.readFileSync(PEER, "utf8");
  fs.writeFileSync(OUT, text, "utf8");
  console.log(`wrote openapi.yaml from peer checkout (${text.length.toLocaleString()} bytes)`);
  console.log(`source: ${PEER}`);
  process.exit(0);
}

// source 2: running server
const base = (process.env.VITE_CUPEL_API ?? "http://127.0.0.1:8814").replace(/\/+$/, "");
const url = `${base}/api/v1/openapi.yaml`;
console.log(`peer checkout not found at ${PEER}`);
console.log(`fetching ${url} ...`);
let r;
try {
  r = await fetch(url);
} catch (e) {
  console.error(`could not reach cupel at ${url}: ${e.message ?? e}`);
  console.error("Start cupel's web server (cd ../cupel/web && npm run start) and try again.");
  process.exit(1);
}
if (!r.ok) {
  console.error(`cupel answered ${r.status} for ${url}`);
  process.exit(1);
}
const text = await r.text();
fs.writeFileSync(OUT, text, "utf8");
console.log(`wrote openapi.yaml from server (${text.length.toLocaleString()} bytes)`);
