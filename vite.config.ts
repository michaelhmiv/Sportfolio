import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(import.meta.dirname, "client", "index.html"),
        oauthConsent: path.resolve(import.meta.dirname, "client", "oauth", "consent", "index.html"),
        connectedApps: path.resolve(
          import.meta.dirname,
          "client",
          "oauth",
          "connected-apps",
          "index.html",
        ),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("rehype-") ||
            id.includes("micromark") ||
            id.includes("unified")
          ) {
            return "vendor-markdown";
          }
          if (id.includes("@capacitor")) return "vendor-native";
          if (id.includes("@radix-ui") || id.includes("vaul")) return "vendor-ui";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("react") || id.includes("wouter")) return "vendor-react";
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
