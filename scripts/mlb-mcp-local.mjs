import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const tmpDir = path.join(repoRoot, "tmp");
const pidFile = path.join(tmpDir, "mlb-mcp-local.json");
const defaultPort = Number.parseInt(process.env.PORT || "8081", 10);
const defaultUrl = `http://127.0.0.1:${defaultPort}/mcp`;

function resolvePythonPath() {
  const candidates =
    process.platform === "win32"
      ? [path.join(repoRoot, "vendor", "mlb-mcp", ".venv", "Scripts", "python.exe")]
      : [
          path.join(repoRoot, "vendor", "mlb-mcp", ".venv", "bin", "python"),
          path.join(repoRoot, "vendor", "mlb-mcp", ".venv", "bin", "python3"),
        ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error(
      "Vendored MLB MCP python runtime was not found. Expected vendor/mlb-mcp/.venv to exist.",
    );
  }
  return match;
}

function ensureTmpDir() {
  fs.mkdirSync(tmpDir, { recursive: true });
}

function readPidFile() {
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return null;
  }
}

function writePidFile(payload) {
  ensureTmpDir();
  fs.writeFileSync(pidFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function removePidFile() {
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isEndpointReachable(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || response.status === 400 || response.status === 405;
  } catch {
    return false;
  }
}

async function waitForReachable(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isEndpointReachable(url)) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

function processExists(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startDetached() {
  const current = readPidFile();
  if (await isEndpointReachable(defaultUrl)) {
    console.log(`MLB MCP already reachable at ${defaultUrl}.`);
    if (current?.pid) {
      console.log(`Recorded PID: ${current.pid}`);
    }
    return;
  }

  if (current?.pid && !processExists(current.pid)) {
    removePidFile();
  }

  const pythonPath = resolvePythonPath();
  ensureTmpDir();

  const child = spawn(pythonPath, ["-m", "mlb_stats_mcp.server", "--http"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(defaultPort),
      PYTHONUNBUFFERED: "1",
    },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();

  writePidFile({
    pid: child.pid,
    port: defaultPort,
    url: defaultUrl,
    startedAt: new Date().toISOString(),
  });

  const reachable = await waitForReachable(defaultUrl);
  if (!reachable) {
    throw new Error(
      `Started local MLB MCP process ${child.pid}, but ${defaultUrl} did not become reachable in time.`,
    );
  }

  console.log(`Started local MLB MCP on ${defaultUrl} (pid ${child.pid}).`);
}

async function startForeground() {
  if (await isEndpointReachable(defaultUrl)) {
    console.log(`MLB MCP already reachable at ${defaultUrl}.`);
    return;
  }

  const pythonPath = resolvePythonPath();
  const child = spawn(pythonPath, ["-m", "mlb_stats_mcp.server", "--http"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(defaultPort),
      PYTHONUNBUFFERED: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Local MLB MCP exited with code ${code}.`));
    });
    child.on("error", reject);
  });
}

async function status() {
  const current = readPidFile();
  const reachable = await isEndpointReachable(defaultUrl);

  if (!current) {
    console.log(
      reachable
        ? `MLB MCP is reachable at ${defaultUrl}, but there is no local pid file.`
        : `MLB MCP is not reachable at ${defaultUrl}.`,
    );
    process.exit(reachable ? 0 : 1);
  }

  const alive = processExists(current.pid);
  if (reachable) {
    console.log(`MLB MCP is reachable at ${defaultUrl} (pid ${current.pid}, alive=${alive}).`);
    return;
  }

  console.log(
    `MLB MCP is not reachable at ${defaultUrl}. Recorded pid ${current.pid} alive=${alive}.`,
  );
  process.exit(1);
}

async function stop() {
  const current = readPidFile();
  if (!current?.pid) {
    console.log("No local MLB MCP pid file found.");
    return;
  }

  try {
    process.kill(current.pid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Could not stop pid ${current.pid}: ${message}`);
  }

  removePidFile();
  console.log(`Stopped local MLB MCP pid ${current.pid}.`);
}

const command = (process.argv[2] || "status").trim().toLowerCase();

try {
  if (command === "start") {
    await startForeground();
  } else if (command === "start-detached") {
    await startDetached();
  } else if (command === "stop") {
    await stop();
  } else if (command === "status") {
    await status();
  } else {
    throw new Error(`Unknown command "${command}". Use start, start-detached, stop, or status.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
