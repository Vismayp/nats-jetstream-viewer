import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "web",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        // The browser origin is the Vite server, while the proxied API is on
        // port 3000. Preserve the API's same-origin CSRF invariant in dev.
        headers: { origin: "http://127.0.0.1:3000" },
      },
    },
  },
});
