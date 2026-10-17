import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The screens, built into static files that live inside the app (OPPORTUNITY-PLAN-APPS.md B1). Relative paths, so
// they load from the app's own address whatever it is; the Python runtime and the core are in public/ and are copied
// as they are. Nothing is loaded from anywhere else.
export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  preview: { host: "127.0.0.1", port: 1421, strictPort: true },
  worker: { format: "es" },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
