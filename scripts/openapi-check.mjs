import { readFileSync } from "node:fs";

const specPath = new URL("../docs/openapi/internal-api.yaml", import.meta.url);
const yaml = readFileSync(specPath, "utf8");

const requiredSnippets = [
  "openapi: 3.1.0",
  "/api/health:",
  "/api/amm/{playerId}:",
  "/api/lp/positions:",
  "/api/holdings/condense:",
];

const missing = requiredSnippets.filter((entry) => !yaml.includes(entry));
if (missing.length) {
  console.error("OpenAPI check failed. Missing entries:");
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}

console.log("OpenAPI check passed.");
