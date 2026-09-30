import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    host: true,
    port: 4317,
    strictPort: true,
    // 本機 HTTP：手機用局域网 IP 或電腦名稱連入，唔好被 host 檢查擋成 403。
    allowedHosts: true,
    proxy: {
      "/api": "http://127.0.0.1:4318",
    },
  },
  preview: {
    host: true,
    port: 4317,
    strictPort: true,
    allowedHosts: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
