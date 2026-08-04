// Generates the OpenAI ChatGPT app submission import from the reviewed MCP catalog.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPluginCatalog, type PluginCatalogEntry } from "../server/mcp/plugin/catalog";

type PositiveCase = {
  id: string;
  userPrompt: string;
  expectedBehavior: string;
};

type NegativeCase = {
  id: string;
  userPrompt: string;
  expectedBehavior: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function readOnlyJustification(tool: PluginCatalogEntry): string {
  if (tool.readOnly) {
    return `Retrieves sanitized ${tool.domain} information and does not modify Sportfolio account or gameplay state.`;
  }
  if (tool.executionModel === "staged_write") {
    return `Creates a pending ${tool.domain} action preview for later confirmation and therefore changes workflow state without finalizing the gameplay operation.`;
  }
  if (tool.executionModel === "finalizer") {
    return `Finalizes or cancels a previously staged Sportfolio action and therefore changes connected-account workflow or gameplay state.`;
  }
  return `Changes the connected user's supported ${tool.domain} state through Sportfolio's shared public MCP implementation.`;
}

function openWorldJustification(): string {
  return "Operates only within the connected user's private Sportfolio game account and does not publish to the public internet or modify an unrelated third-party system.";
}

function destructiveJustification(tool: PluginCatalogEntry): string {
  if (tool.destructive) {
    return `Can complete an irreversible or deletion-style ${tool.domain} action after the user's request and any required confirmation.`;
  }
  if (tool.executionModel === "staged_write") {
    return "Only creates a reviewable pending action; the underlying gameplay operation is not applied until a separate confirmed finalizer runs.";
  }
  return "Does not delete, revoke, irreversibly overwrite, or finalize a destructive action according to the implemented tool behavior.";
}

function toolImport(tool: PluginCatalogEntry) {
  return {
    annotations: {
      readOnlyHint: tool.readOnly,
      openWorldHint: tool.openWorld,
      destructiveHint: tool.destructive,
    },
    justifications: {
      read_only_justification: readOnlyJustification(tool),
      open_world_justification: openWorldJustification(),
      destructive_justification: destructiveJustification(tool),
    },
  };
}

const positiveToolMap: Record<string, string> = {
  "public-player-research": "search_players, get_player_detail, get_player_recent_games",
  "portfolio-overview": "get_portfolio_summary",
  "confirmed-market-buy": "search_players, stage_market_buy, confirm_pending_action",
  "confirmed-daily-boost": "list_daily_boost_eligible_players, stage_daily_boost_assign, confirm_pending_action",
  "watchlist-management": "search_players, create_watchlist, add_watchlist_player",
};

const positive = readJson<{ cases: PositiveCase[] }>(
  "docs/plugin/submission/positive-test-cases.json",
);
const negative = readJson<{ cases: NegativeCase[] }>(
  "docs/plugin/submission/negative-test-cases.json",
);
const catalog = buildPluginCatalog().sort((a, b) => a.name.localeCompare(b.name));

if (positive.cases.length !== 5 || negative.cases.length !== 3) {
  throw new Error("Submission import requires exactly five positive and three negative cases.");
}

const submission = {
  $schema: "https://developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json",
  schema_version: 1,
  app_info: {
    display_name: "Sportfolio",
    subtitle: "Manage virtual sports",
    description:
      "Sportfolio lets users research supported players and games, review a connected virtual sports portfolio, and carry out supported market, scouting, boost, liquidity, watchlist, schedule, profile, and gameplay actions through ChatGPT.",
    category: "ENTERTAINMENT",
  },
  tools: Object.fromEntries(catalog.map((tool) => [tool.name, toolImport(tool)])),
  test_cases: positive.cases.map((testCase) => ({
    description: testCase.id.replace(/-/g, " "),
    user_prompt: testCase.userPrompt,
    file_attachment_urls: null,
    tools_triggered: positiveToolMap[testCase.id] || null,
    expected_output: testCase.expectedBehavior,
    expected_output_url: null,
  })),
  negative_test_cases: negative.cases.map((testCase) => ({
    description: testCase.id.replace(/-/g, " "),
    user_prompt: testCase.userPrompt,
    file_attachment_urls: null,
    tools_triggered: null,
    expected_output: testCase.expectedBehavior,
    expected_output_url: null,
  })),
};

const outputPath = resolve("chatgpt-app-submission.json");
const rendered = `${JSON.stringify(submission, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const existing = readFileSync(outputPath, "utf8");
  if (existing !== rendered) {
    console.error("chatgpt-app-submission.json is stale. Regenerate it before submission.");
    process.exit(1);
  }
  console.log(`Submission import verified: ${catalog.length} static tools, 5 positive cases, 3 negative cases.`);
} else {
  writeFileSync(outputPath, rendered, "utf8");
  console.log(`Generated chatgpt-app-submission.json for ${catalog.length} static tools.`);
}
