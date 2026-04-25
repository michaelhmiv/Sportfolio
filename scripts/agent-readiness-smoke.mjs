import { spawnSync } from "node:child_process";

const npmCmd = "npm";

const commands = [
  [npmCmd, ["run", "text:check"]],
  [npmCmd, ["run", "check"]],
  [npmCmd, ["run", "lint"]],
  [npmCmd, ["run", "test:run"]],
  [npmCmd, ["run", "openapi:check"]],
];

for (const [cmd, args] of commands) {
  console.log(`\n-> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\nAgent readiness smoke failed at: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAgent readiness smoke passed.");
