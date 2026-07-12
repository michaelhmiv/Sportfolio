import { readFileSync } from "node:fs";

const specPath = new URL("../docs/openapi/internal-api.yaml", import.meta.url);
const yaml = readFileSync(specPath, "utf8");
const lines = yaml.split(/\r?\n/);

function indentation(line) {
  return line.length - line.trimStart().length;
}

function fail(message) {
  console.error(`OpenAPI check failed: ${message}`);
  process.exit(1);
}

function findBlock(sourceLines, header, expectedIndent, context) {
  const expectedLine = `${" ".repeat(expectedIndent)}${header}`;
  const startIndex = sourceLines.findIndex((line) => line === expectedLine);
  if (startIndex === -1) {
    fail(`${context} missing ${header}`);
  }

  let endIndex = sourceLines.length;
  for (let index = startIndex + 1; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    if (line.trim() && indentation(line) <= expectedIndent) {
      endIndex = index;
      break;
    }
  }

  return sourceLines.slice(startIndex + 1, endIndex);
}

if (!lines.includes("openapi: 3.1.0")) {
  fail("missing exact openapi: 3.1.0 declaration");
}

const requiredOperations = [
  { path: "/api/health", method: "get" },
  { path: "/api/amm/{playerId}", method: "get", pathParameters: ["playerId"] },
  { path: "/api/lp/positions", method: "get" },
  { path: "/api/holdings/stack-shares", method: "post" },
  {
    path: "/api/holdings/{playerId}/multiplier-state",
    method: "get",
    pathParameters: ["playerId"],
  },
];

const pathsBlock = findBlock(lines, "paths:", 0, "document");
for (const operation of requiredOperations) {
  const pathBlock = findBlock(pathsBlock, `${operation.path}:`, 2, "paths");
  const operationBlock = findBlock(
    pathBlock,
    `${operation.method}:`,
    4,
    `${operation.path} path item`,
  );

  for (const parameterName of operation.pathParameters ?? []) {
    const parameterBlock = findBlock(
      operationBlock,
      `- name: ${parameterName}`,
      8,
      `${operation.method.toUpperCase()} ${operation.path}`,
    );
    if (!parameterBlock.includes("          in: path")) {
      fail(
        `${operation.method.toUpperCase()} ${operation.path} parameter ${parameterName} is not in path`,
      );
    }
    if (!parameterBlock.includes("          required: true")) {
      fail(
        `${operation.method.toUpperCase()} ${operation.path} parameter ${parameterName} is not required`,
      );
    }
  }
}

console.log("OpenAPI check passed.");
