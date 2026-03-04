import { existsSync, readFileSync } from "node:fs";

const reportPath = "tmp/agent-debug/latest.json";
if (!existsSync(reportPath)) {
  console.error(`Self-improve: missing ${reportPath}. Run \`npm run agent:debug\` first.`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const failed = report.results.find((r) => r.exitCode !== 0);

if (!failed) {
  console.log("Self-improve: loop healthy. No remediation needed.");
  process.exit(0);
}

const suggestions = {
  check: [
    "Run `tsc --pretty false` to capture exact file/line diagnostics.",
    "Fix type errors in changed files first, then rerun `npm run check`.",
  ],
  lint: [
    "Run `npm run lint -- --fix` or targeted `eslint --fix` for touched files.",
    "Resolve remaining rule violations and rerun lint.",
  ],
  test: [
    "Run the failing Vitest file directly (e.g. `vitest run <file>`).",
    "Patch behavior or tests, then rerun `npm run test:run`.",
  ],
  openapi: [
    "Update `docs/openapi/internal-api.yaml` to include missing required paths.",
    "Rerun `npm run openapi:check`.",
  ],
  invariants: [
    "Review `scripts/check-agent-invariants.mjs` expectations.",
    "Align docs/schema references and rerun invariants check.",
  ],
};

const actions = suggestions[failed.name] || [
  "Inspect command output tails in tmp/agent-debug/latest.json.",
  "Apply a targeted fix and rerun npm run agent:debug.",
];

console.log(`Self-improve: first failed step is '${failed.name}' (${failed.command}).`);
console.log("Recommended next actions:");
for (const action of actions) console.log(`- ${action}`);
