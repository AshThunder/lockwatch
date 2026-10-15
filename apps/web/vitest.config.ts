import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"), "@": path.resolve(__dirname, "src") } },
  test: { env: { DATABASE_URL: "memory", NEXT_PUBLIC_CHAIN_ID: "31611" }, testTimeout: 20000 },
});
