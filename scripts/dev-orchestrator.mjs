import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const isWindows = process.platform === "win32";
const mcpPythonPath = isWindows
  ? resolve(rootDir, "vendor", "mlb-mcp", ".venv", "Scripts", "python.exe")
  : resolve(rootDir, "vendor", "mlb-mcp", ".venv", "bin", "python");

const trackedChildren = [];
let shuttingDown = false;

const log = (message) => {
  console.log(`[dev] ${message}`);
};

const checkPortOpen = (port, host = "127.0.0.1") =>
  new Promise((resolvePortOpen) => {
    const socket = net.createConnection({ port, host });
    const done = (open) => {
      socket.destroy();
      resolvePortOpen(open);
    };

    socket.setTimeout(1000);
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
  });

const stopChildren = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of trackedChildren) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of trackedChildren) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 2000).unref();
};

const spawnNpm = (args, options = {}) => {
  if (isWindows) {
    return spawn("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], options);
  }

  return spawn("npm", args, options);
};

const runAppServer = () => {
  const appChild = spawnNpm(["run", "dev:app"], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });

  trackedChildren.push(appChild);

  appChild.on("error", (error) => {
    console.error("[dev] Failed to start app server:", error);
    stopChildren(1);
  });

  appChild.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(`App server exited (${signal || code || 0}). Stopping dev session.`);
    stopChildren(code || 0);
  });
};

const runMlbMcpIfAvailable = async () => {
  const mcpEnabled = String(process.env.HERMES_INTERNAL_MLB_MCP_ENABLED || "").toLowerCase();
  if (mcpEnabled === "false") {
    log("Skipping local MLB MCP sidecar (HERMES_INTERNAL_MLB_MCP_ENABLED=false).");
    return;
  }

  const mcpPort = Number.parseInt(process.env.MLB_MCP_PORT || "8081", 10);
  if (Number.isNaN(mcpPort) || mcpPort <= 0) {
    log("Invalid MLB_MCP_PORT value. Skipping local MLB MCP sidecar.");
    return;
  }

  if (await checkPortOpen(mcpPort)) {
    log(`Detected existing service on 127.0.0.1:${mcpPort}. Reusing it for MLB MCP.`);
    return;
  }

  if (!existsSync(mcpPythonPath)) {
    log(
      `Local MLB MCP venv not found at ${mcpPythonPath}. Continuing without sidecar (see docs/mlb-mcp.md setup).`,
    );
    return;
  }

  log(`Starting local MLB MCP sidecar on port ${mcpPort}...`);
  const mcpChild = spawn(mcpPythonPath, ["-m", "mlb_stats_mcp.server", "--http"], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(mcpPort),
    },
  });

  trackedChildren.push(mcpChild);

  mcpChild.on("error", (error) => {
    console.error("[dev] Failed to start local MLB MCP sidecar:", error);
  });

  mcpChild.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(`Local MLB MCP sidecar exited (${signal || code || 0}). App server remains running.`);
  });
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`Received ${signal}, shutting down.`);
    stopChildren(0);
  });
}

const main = async () => {
  runAppServer();
  await runMlbMcpIfAvailable();
};

main().catch((error) => {
  console.error("[dev] Failed to start dev orchestrator:", error);
  stopChildren(1);
});
