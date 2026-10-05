import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8")) as {
  version: string;
};

/**
 * GitHub Pages project site:
 *   https://f77f77.github.io/acg-tools/champions/
 * Asset prefix is `/acg-tools/champions/` (site path `/champions/`).
 * `npm run dev` keeps base `/` so Electron can load http://localhost:5173.
 * Packaged Electron (`electron:build`) sets VITE_BASE=./ for file:// loads.
 */
const PAGES_BASE = "/acg-tools/champions/";

export default defineConfig(({ command }) => {
  const pagesBase = process.env.VITE_BASE || PAGES_BASE;
  const base = command === "serve" ? "/" : pagesBase;
  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    base,
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
