import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

const steps = [
  ["check", "npm", ["run", "check"]],
  ["lint", "npm", ["run", "lint"]],
  ["test", "npm", ["run", "test:run"]],
  ["openapi", "npm", ["run", "openapi:check"]],
  ["invariants", "npm", ["run", "invariants:check"]],
];

const results = [];
let overallSuccess = true;

for (const [name, cmd, args] of steps) {
  const t0 = performance.now();
  const run = spawnSync(cmd, args, {
    env: process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Math.round(performance.now() - t0);
  const ok = run.status === 0;
  if (!ok) overallSuccess = false;

  results.push({
    name,
    command: `${cmd} ${args.join(" ")}`,
    exitCode: run.status,
    durationMs,
    stdoutTail: (run.stdout || "").split("\n").slice(-40).join("\n"),
    stderrTail: (run.stderr || "").split("\n").slice(-40).join("\n"),
  });

  if (!ok) break;
}

mkdirSync("tmp/agent-debug", { recursive: true });
const payload = {
  createdAt: new Date().toISOString(),
  success: overallSuccess,
  results,
};
writeFileSync("tmp/agent-debug/latest.json", JSON.stringify(payload, null, 2));

const md = [
  `# Agent Debug Loop Report`,
  "",
  `- Created: ${payload.createdAt}`,
  `- Success: ${payload.success}`,
  "",
  "## Steps",
  ...results.map((r) => `- ${r.name}: \`${r.command}\` → exit ${r.exitCode} (${r.durationMs}ms)`),
  "",
].join("\n");
writeFileSync("tmp/agent-debug/latest.md", md);

console.log(md);
if (!overallSuccess) process.exit(1);
