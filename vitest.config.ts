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
    exclude: [...configDefaults.exclude, "vendor/**", "**/vendor/**", "tests/e2e/**"],
    coverage: {
      reporter: ["text", "html"],
      thresholds: {
        lines: 30,
        functions: 35,
        statements: 30,
        branches: 25,
      },
    },
  },
});
