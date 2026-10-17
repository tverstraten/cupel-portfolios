// The screens as the test variant of the app carries them (src-tauri/tauri.test.conf.json): pointed at the stand-in
// API the end-to-end test runs on 127.0.0.1:18814, with the optimizer switched on so it can be tested in the real
// program, and without opening a browser on the machine the test runs on (the sign-in link is shown instead). A release never runs this: its screens are `npm run build`, with no flag set.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, VITE_CUPEL_API: "http://127.0.0.1:18814", VITE_CUPEL_SITE: "http://127.0.0.1:18814", VITE_CUPEL_OPTIMIZER: "on", VITE_CUPEL_BROWSER: "off" };
execFileSync(process.execPath, [path.join(APP, "scripts", "bundle-core.mjs")], { cwd: APP, stdio: "inherit" });
execFileSync(process.execPath, [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: APP, env, stdio: "inherit" });
