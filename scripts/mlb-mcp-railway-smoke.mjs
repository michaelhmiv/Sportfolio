import { spawn } from "node:child_process";
import process from "node:process";

const WINDOWS_RAILWAY_CLI =
  process.platform === "win32" && process.env.APPDATA
    ? `${process.env.APPDATA}\\npm\\node_modules\\@railway\\cli\\bin\\railway.js`
    : null;

const service = process.argv[2] || "mlb-mcp";
const environment = process.argv[3] || "production";
const spawnCommand = WINDOWS_RAILWAY_CLI ? process.execPath : "railway";

const smokeTests = [
  {
    name: "test_get_schedule_tool",
    args: [
      "python",
      "-m",
      "pytest",
      "/app/mlb_stats_mcp/tests/test_mlbstats.py::test_get_schedule_tool",
      "-q",
    ],
  },
  {
    name: "test_get_stats_tool",
    args: [
      "python",
      "-m",
      "pytest",
      "/app/mlb_stats_mcp/tests/test_mlbstats.py::test_get_stats_tool",
      "-q",
    ],
  },
  {
    name: "test_get_available_endpoints_tool",
    args: [
      "python",
      "-m",
      "pytest",
      "/app/mlb_stats_mcp/tests/test_mlbstats.py::test_get_available_endpoints_tool",
      "-q",
    ],
  },
  {
    name: "test_get_last_game_tool",
    args: [
      "python",
      "-m",
      "pytest",
      "/app/mlb_stats_mcp/tests/test_mlbstats.py::test_get_last_game_tool",
      "-q",
    ],
  },
  {
    name: "test_get_next_game_tool",
    args: [
      "python",
      "-m",
      "pytest",
      "/app/mlb_stats_mcp/tests/test_mlbstats.py::test_get_next_game_tool",
      "-q",
    ],
  },
];

function runRailwayCommand(args) {
  const railwayArgs = ["ssh", "-s", service, "-e", environment, ...args];
  const spawnArgs = WINDOWS_RAILWAY_CLI ? [WINDOWS_RAILWAY_CLI, ...railwayArgs] : railwayArgs;

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function main() {
  const results = [];

  for (const smokeTest of smokeTests) {
    const result = await runRailwayCommand(smokeTest.args);
    results.push({
      name: smokeTest.name,
      ok: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr || null,
    });
  }

  const allPassed = results.every((result) => result.ok);

  console.log(
    JSON.stringify(
      {
        ok: allPassed,
        service,
        environment,
        results,
      },
      null,
      2,
    ),
  );

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
