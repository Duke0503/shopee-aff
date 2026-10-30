/**
 * The admin desk build (AD-21): a static SPA under /admin/ on the admin host, served by the public
 * listener. In development /api goes to the local server's public listener.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export const ADMIN_BASE = "/admin/";

export default defineConfig({
  base: ADMIN_BASE,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:9080", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
});
