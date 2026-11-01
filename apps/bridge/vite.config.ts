// Builds the unpacked extension into dist/: the module service worker, the options page and the
// manifest from public/. Not minified, so the operator can read what runs in the affiliate browser.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    target: "chrome120",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: { background: "src/background.ts", options: "options.html" },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js", assetFileNames: "assets/[name][extname]" },
    },
  },
});
