/**
 * The customer website build (AD-21): a static SPA at the root of hoantiendp.com, served by the
 * public listener beside the server pages /s/<code> and /b/<token>. In development /api goes to
 * the local server's public listener.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export const WEB_BASE = "/";
export const WEB_DEV_PORT = 5175;

export default defineConfig({
  base: WEB_BASE,
  plugins: [react(), tailwindcss()],
  server: {
    port: WEB_DEV_PORT,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:9080", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
});
