import fs from "node:fs";
import path from "node:path";

const packagePath = path.resolve("mobile/ios/App/CapApp-SPM/Package.swift");

if (!fs.existsSync(packagePath)) {
  console.log("[mobile] iOS Package.swift not found; skipping SPM path normalization.");
  process.exit(0);
}

const original = fs.readFileSync(packagePath, "utf8");
const normalized = original.replace(/path:\s*"([^"]*)"/g, (_match, packagePathValue) => {
  return `path: "${packagePathValue.replace(/\\/g, "/")}"`;
});

if (normalized === original) {
  console.log("[mobile] iOS SPM paths already normalized.");
  process.exit(0);
}

fs.writeFileSync(packagePath, normalized, "utf8");
console.log("[mobile] Normalized iOS SPM path separators in Package.swift.");
