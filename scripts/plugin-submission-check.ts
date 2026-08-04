import { readFileSync } from "node:fs";

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

const positive = readJson("docs/plugin/submission/positive-test-cases.json");
const negative = readJson("docs/plugin/submission/negative-test-cases.json");
const listing = readFileSync("docs/plugin/submission/listing-copy.md", "utf8");
const reviewer = readFileSync("docs/plugin/submission/reviewer-instructions.md", "utf8");
const fixture = readFileSync("docs/plugin/submission/demo-account-fixtures.md", "utf8");
const releaseNotes = readFileSync("docs/plugin/submission/release-notes.md", "utf8");
const attestations = readFileSync("docs/plugin/submission/policy-attestations.md", "utf8");

const errors: string[] = [];
if (!Array.isArray(positive.cases) || positive.cases.length !== 5) {
  errors.push("Exactly five positive test cases are required.");
}
if (!Array.isArray(negative.cases) || negative.cases.length !== 3) {
  errors.push("Exactly three negative test cases are required.");
}

for (const testCase of positive.cases || []) {
  for (const field of ["id", "userPrompt", "expectedBehavior", "expectedResultShape", "fixture"]) {
    if (!testCase[field]) errors.push(`Positive case ${testCase.id || "unknown"} is missing ${field}.`);
  }
}
for (const testCase of negative.cases || []) {
  for (const field of ["id", "userPrompt", "expectedBehavior", "whyNot"]) {
    if (!testCase[field]) errors.push(`Negative case ${testCase.id || "unknown"} is missing ${field}.`);
  }
}

const positiveIds = new Set((positive.cases || []).map((entry: any) => entry.id));
for (const id of [
  "public-player-research",
  "portfolio-overview",
  "confirmed-market-buy",
  "confirmed-daily-boost",
  "watchlist-management",
]) {
  if (!positiveIds.has(id)) errors.push(`Required positive action case is missing: ${id}.`);
}

const positiveText = JSON.stringify(positive);
for (const toolName of [
  "get_portfolio_summary",
  "stage_market_buy",
  "stage_daily_boost_assign",
  "confirm_pending_action",
  "create_watchlist",
  "add_watchlist_player",
]) {
  if (!positiveText.includes(toolName)) {
    errors.push(`Positive reviewer cases do not exercise ${toolName}.`);
  }
}

for (const url of [
  "https://www.sportfolio.market",
  "https://www.sportfolio.market/plugin/",
  "https://www.sportfolio.market/plugin-support/",
  "https://www.sportfolio.market/privacy",
  "https://www.sportfolio.market/terms",
]) {
  if (!listing.includes(url)) errors.push(`Listing copy is missing ${url}.`);
}

const reviewerMaterial = `${reviewer}\n${fixture}`;
const reviewerRequirements: Array<[string, RegExp]> = [
  ["no MFA", /(?:no\s+MFA|MFA\s+disabled)/i],
  ["no SMS", /(?:no\s+SMS|SMS\s+requirement|no\s+phone\s+number)/i],
  ["no email confirmation", /(?:no\s+email[- ]confirmation|email\s+confirmed\s+before\s+submission)/i],
  ["no admin access", /(?:no\s+admin|non-admin)/i],
  ["no private network", /(?:no\s+VPN|no\s+private[- ]network)/i],
];
for (const [label, pattern] of reviewerRequirements) {
  if (!pattern.test(reviewerMaterial)) {
    errors.push(`Reviewer material is missing requirement: ${label}.`);
  }
}

for (const phrase of [
  "explicit confirmation",
  "confirm_pending_action",
  "cancel_pending_action",
  "staged",
  "exact bundle",
]) {
  if (!reviewerMaterial.toLowerCase().includes(phrase.toLowerCase())) {
    errors.push(`Reviewer material is missing action-control guidance: ${phrase}.`);
  }
}

const combined = [listing, reviewer, fixture, releaseNotes, attestations].join("\n");
const credentialPatterns = [
  /password\s*[:=]\s*\S+/i,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];
for (const pattern of credentialPatterns) {
  if (pattern.test(combined)) errors.push(`Submission documents appear to contain a credential: ${pattern}.`);
}

if (!releaseNotes.toLowerCase().includes("initial")) {
  errors.push("Release notes must state this is an initial submission.");
}
if (!attestations.includes("[ ]")) {
  errors.push("Policy attestation worksheet is missing review checkboxes.");
}

if (errors.length) {
  console.error("Plugin submission check failed:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`Submission kit verified: ${positive.cases.length} positive and ${negative.cases.length} negative cases.`);
