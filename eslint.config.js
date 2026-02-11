import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "mobile/**",
      "package/**",
      "tmp/**",
      "attached_assets/**",
      "migrations/**",
      "package-lock.json",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}", "server/**/*.ts", "client/src/**/*.{ts,tsx}", "shared/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "off",
      complexity: ["warn", 20],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "prefer-const": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-case-declarations": "off",
      "no-useless-escape": "off",
    },
  },
);
