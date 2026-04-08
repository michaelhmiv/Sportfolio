import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const isWindows = process.platform === "win32";
const pythonPath = isWindows
  ? resolve(rootDir, "vendor", "mlb-mcp", ".venv", "Scripts", "python.exe")
  : resolve(rootDir, "vendor", "mlb-mcp", ".venv", "bin", "python");

if (!existsSync(pythonPath)) {
  console.error(
    `[dev:mcp] MLB MCP venv python not found at ${pythonPath}. Follow docs/mlb-mcp.md setup.`,
  );
  process.exit(1);
}

const port = process.env.MLB_MCP_PORT || "8081";
console.log(`[dev:mcp] Starting MLB MCP sidecar on port ${port}...`);

const child = spawn(pythonPath, ["-m", "mlb_stats_mcp.server", "--http"], {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
  },
});

const shutdown = () => {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

child.on("error", (error) => {
  console.error("[dev:mcp] Failed to start MLB MCP sidecar:", error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
