import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "text:check"]],
  ["npm", ["run", "check"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "test:run"]],
  ["npm", ["run", "openapi:check"]],
];

for (const [cmd, args] of commands) {
  console.log(`\n▶ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`\nAgent readiness smoke failed at: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAgent readiness smoke passed.");
