import path from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// The built app is served by the Python process from
// src/cashback/web/static, so there is no node runtime in production --
// `npm run build` is the only time node is needed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: path.resolve(__dirname, "../src/cashback/web/static"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-query": ["@tanstack/react-query"],
          "vendor-table": ["@tanstack/react-table"],
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-slot",
            "@radix-ui/react-tabs",
          ],
          "vendor-qr": ["qrcode"],
        },
      },
    },
  },
  server: {
    // `npm run dev` talks to the real bot process for live data.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8899",
        headers: {
          "CF-Connecting-IP": "127.0.0.1",
        },
      },
    },
  },
})
