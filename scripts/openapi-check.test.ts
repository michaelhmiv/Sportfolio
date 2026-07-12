import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const checkerSource = readFileSync(join(root, "scripts/openapi-check.mjs"), "utf8");
const canonicalSpec = readFileSync(join(root, "docs/openapi/internal-api.yaml"), "utf8");
const fixtureDirectories: string[] = [];

function replaceInPath(path: string, from: string, to: string): string {
  const lines = canonicalSpec.split(/\r?\n/);
  const startIndex = lines.indexOf(`  ${path}:`);
  expect(startIndex).toBeGreaterThanOrEqual(0);

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^ {2}\S/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  const block = lines.slice(startIndex, endIndex).join("\n");
  expect(block).toContain(from);
  return [...lines.slice(0, startIndex), block.replace(from, to), ...lines.slice(endIndex)].join(
    "\n",
  );
}

function runChecker(spec: string) {
  const directory = mkdtempSync(join(tmpdir(), "sportfolio-openapi-"));
  fixtureDirectories.push(directory);

  const files = [
    ["scripts/openapi-check.mjs", checkerSource],
    ["docs/openapi/internal-api.yaml", spec],
  ] as const;

  for (const [relativePath, content] of files) {
    const destination = join(directory, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }

  return spawnSync(process.execPath, [join(directory, "scripts/openapi-check.mjs")], {
    encoding: "utf8",
  });
}

afterAll(() => {
  for (const directory of fixtureDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("openapi-check CLI", () => {
  it("accepts the canonical OpenAPI contract", () => {
    expect(runChecker(canonicalSpec).status).toBe(0);
  });

  it("rejects the wrong OpenAPI version", () => {
    expect(runChecker(canonicalSpec.replace("openapi: 3.1.0", "openapi: 3.0.0")).status).not.toBe(
      0,
    );
  });

  it.each([
    ["/api/health", "get", "post"],
    ["/api/amm/{playerId}", "get", "post"],
    ["/api/lp/positions", "get", "post"],
    ["/api/holdings/stack-shares", "post", "get"],
    ["/api/holdings/{playerId}/multiplier-state", "get", "post"],
  ])("rejects the wrong method for %s", (path, expectedMethod, replacementMethod) => {
    const spec = replaceInPath(path, `    ${expectedMethod}:`, `    ${replacementMethod}:`);
    expect(runChecker(spec).status).not.toBe(0);
  });

  it.each(["/api/amm/{playerId}", "/api/holdings/{playerId}/multiplier-state"])(
    "rejects a non-required playerId parameter for %s",
    (path) => {
      const spec = replaceInPath(path, "          required: true", "          required: false");
      expect(runChecker(spec).status).not.toBe(0);
    },
  );

  it("rejects a playerId parameter that is not declared in the path", () => {
    const spec = replaceInPath("/api/amm/{playerId}", "          in: path", "          in: query");
    expect(runChecker(spec).status).not.toBe(0);
  });
});
