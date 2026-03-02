import fs from "node:fs";
import path from "node:path";
import { buildDocsManifest } from "./docs-lib.mjs";

const outputDir = path.resolve(process.cwd(), "shared", "generated");
const outputPath = path.join(outputDir, "docs-manifest.json");
const manifest = buildDocsManifest();

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`[docs:build] Wrote ${manifest.articles.length} articles to ${outputPath}`);
