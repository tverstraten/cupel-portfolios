// The shell of the user's application (OPPORTUNITY-PLAN-APPS.md B1): one window drawn by the system's own web view
// (WebView2 on Windows, WKWebView on macOS) over the files built into the program. It starts no server and opens
// no port. The screens are React; the numbers come from cupel's Python core, run inside the window by Pyodide.
//
// What the window may do is in capabilities/default.json and tauri.conf.json, and nothing else: read and write the
// app's own data folder, ask cupel's API, and open cupel's sign-in page in the person's browser. app/tests/policy.test.mjs holds both to that.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("Cupel could not start");
}
