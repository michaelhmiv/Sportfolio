import { readFile } from "node:fs/promises";

const prompts = JSON.parse(await readFile("docs/plugin/golden-prompts.json", "utf8"));
if (!Array.isArray(prompts) || prompts.length < 30) {
  throw new Error(`Expected at least 30 golden prompts; found ${prompts?.length ?? 0}.`);
}

const positive = prompts.filter((entry) => entry.type === "positive");
const negative = prompts.filter((entry) => entry.type === "negative");
if (positive.length < 5 || negative.length < 3) {
  throw new Error("Golden prompt set must contain at least 5 positive and 3 negative cases.");
}

const retired = /stage_stack_shares|get_holding_multiplier_state|stack power|stack shares/i;
for (const entry of prompts) {
  if (!entry.id || !entry.prompt || !entry.type || !Array.isArray(entry.expectedTools)) {
    throw new Error(`Malformed golden prompt: ${JSON.stringify(entry)}`);
  }
  if (entry.expectedTools.some((tool) => retired.test(tool))) {
    throw new Error(`Golden prompt routes to retired Stack/runtime surface: ${entry.id}`);
  }
}

console.log(
  `Golden prompt check passed: ${prompts.length} cases (${positive.length} positive, ${negative.length} negative).`,
);
