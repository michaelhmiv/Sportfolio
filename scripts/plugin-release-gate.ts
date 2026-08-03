import { readFileSync } from "node:fs";

const strict = process.argv.includes("--strict") || process.env.PLUGIN_RELEASE_MODE === "true";
const appBinding = JSON.parse(readFileSync("plugins/sportfolio/.app.json", "utf8"));
const appId = appBinding.apps?.sportfolio?.id;

const checks = [
  {
    id: "app_binding",
    passed: typeof appId === "string" && /^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(appId),
    detail: "Replace the .app.json placeholder with the assigned Sportfolio plugin_asdk_app ID.",
  },
  {
    id: "domain_challenge",
    passed: Boolean(process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim()),
    detail: "Set the OpenAI domain challenge token in the production service.",
  },
  {
    id: "plugin_enabled",
    passed: process.env.PLUGIN_MCP_ENABLED === "true",
    detail: "Enable the production marketplace endpoint with PLUGIN_MCP_ENABLED=true.",
  },
  {
    id: "oauth_client_allowlist",
    passed: Boolean(process.env.PLUGIN_OAUTH_ALLOWED_CLIENT_IDS?.trim()),
    detail: "Set the approved ChatGPT/Codex OAuth client ID allowlist after registration.",
  },
  {
    id: "reviewer_account",
    passed: process.env.PLUGIN_REVIEWER_ACCOUNT_READY === "true",
    detail: "Create and seed the synthetic reviewer account and store credentials only in the submission portal.",
  },
  {
    id: "security_advisors",
    passed: process.env.PLUGIN_SUPABASE_SECURITY_REVIEW_COMPLETE === "true",
    detail: "Resolve or formally disposition the Supabase security-advisor errors before submission.",
  },
  {
    id: "legal_review",
    passed: process.env.PLUGIN_LEGAL_REVIEW_COMPLETE === "true",
    detail: "Complete final legal review of privacy, terms, and country availability.",
  },
];

console.log("Sportfolio plugin release gate");
for (const check of checks) {
  console.log(`${check.passed ? "PASS" : "BLOCKED"} ${check.id}: ${check.detail}`);
}

const blocked = checks.filter((check) => !check.passed);
if (strict && blocked.length > 0) {
  console.error(`Release blocked by ${blocked.length} unresolved gate(s).`);
  process.exit(1);
}

if (blocked.length === 0) {
  console.log("All external release gates are satisfied.");
} else {
  console.log(`Pre-release mode: ${blocked.length} external gate(s) remain intentionally unresolved.`);
}
