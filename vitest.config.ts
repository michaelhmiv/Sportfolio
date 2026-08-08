import react from "@vitejs/plugin-react";
import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    globals: true,
    exclude: [
      ...configDefaults.exclude,
      "vendor/**",
      "**/vendor/**",
      ".claude/**",
      "**/.claude/**",
      "tests/e2e/**",
      "tests/visual/**",
    ],
    coverage: {
      reporter: ["text", "html"],
      thresholds: {
        // PR validation was restored in August 2026 after being disabled. The first
        // complete coverage run measured 23.29% lines/statements; enforce that
        // baseline immediately so future changes cannot silently reduce it.
        lines: 23,
        functions: 35,
        statements: 23,
        branches: 25,
      },
    },
  },
});
