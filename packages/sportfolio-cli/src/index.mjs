import { clearConfig, getConfigPath, loadConfig, normalizeBaseUrl, saveConfig } from "./config.mjs";
import { requestJson } from "./http.mjs";
import { fail, printJson, printList } from "./output.mjs";

const COMMAND_HELP = {
  auth: [
    "Auth Commands",
    "",
    "Usage:",
    "  auth login --token <token> [--base-url <url>]",
    "  auth whoami",
    "  auth logout",
    "",
    "Examples:",
    "  sportfolio auth login --token <token>",
    "  sportfolio auth login --token <token> --base-url http://127.0.0.1:5000",
  ],
  docs: [
    "Docs Commands",
    "",
    "Usage:",
    "  docs list",
    "  docs search <query>",
    "  docs open <section>/<slug>",
    "",
    "Examples:",
    "  sportfolio docs search power boosts",
    "  sportfolio docs open cli/command-reference",
  ],
  portfolio: ["Portfolio Commands", "", "Usage:", "  portfolio summary"],
  agent: [
    "Agent Commands",
    "",
    "Usage:",
    "  agent threads",
    "  agent ask <prompt> [--thread <threadId>]",
    "  agent confirm <threadId> [--pending-bundle <bundleId>]",
    "  agent cancel <threadId> [--pending-bundle <bundleId>]",
    "",
    "Examples:",
    '  sportfolio agent ask "what is my current balance?"',
    '  sportfolio agent ask "review my setup" --thread <threadId>',
  ],
  actions: [
    "Action Staging Commands",
    "",
    "Usage:",
    "  actions buy <player-name-or-id> --dollars <amount> [--thread <threadId>]",
    "  actions sell <player-name-or-id> --shares <amount> [--thread <threadId>]",
    "  actions watchlist add <player-name-or-id> [--thread <threadId>]",
    "  actions watchlist remove <player-name-or-id> [--thread <threadId>]",
    "  actions community-boost <player-name> [--timing today|tomorrow] [--thread <threadId>]",
    "",
    "Notes:",
    "  - Action commands stage a plan and still require explicit confirm.",
    "  - For community boosts, prefer full player names for best resolution.",
  ],
  tools: [
    "Public Tool Commands",
    "",
    "Usage:",
    "  tools list",
    "  tools call <tool-name> [--args-json <json>]",
    "",
    "Examples:",
    "  sportfolio tools list",
    "  sportfolio tools call get_account_profile",
    '  sportfolio tools call stage_market_buy --args-json {"playerId":"nba_1","amount":25}',
  ],
  prompts: [
    "Public Prompt Commands",
    "",
    "Usage:",
    "  prompts list",
    "  prompts render <prompt-name> [--args-json <json>]",
    "",
    "Examples:",
    "  sportfolio prompts list",
    '  sportfolio prompts render find_boost_candidates --args-json {"sport":"NBA"}',
  ],
  resources: [
    "Public Resource Commands",
    "",
    "Usage:",
    "  resources list",
    "  resources read <uri>",
    "",
    "Examples:",
    "  sportfolio resources list",
    "  sportfolio resources read sportfolio://docs/index",
  ],
};

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return "";
  }

  return args[index + 1] || "";
}

function removeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return args;
  }

  const nextArgs = [...args];
  nextArgs.splice(index, 2);
  return nextArgs;
}

function parseJsonOption(args, name) {
  const rawValue = readOption(args, name);
  if (!rawValue) {
    return {};
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    throw Object.assign(new Error(`Invalid JSON for ${name}`), { exitCode: 1 });
  }
}

function getJsonMode(args) {
  return args.includes("--json");
}

function stripGlobalFlags(args) {
  return args.filter((arg) => arg !== "--json");
}

function printHelp() {
  printList([
    "Sportfolio CLI",
    "",
    "Global flags:",
    "  --json    Output raw JSON",
    "",
    "Use `sportfolio <command> --help` for command-specific usage.",
    "",
    "Commands:",
    "  auth login --token <token> [--base-url <url>]",
    "  auth whoami",
    "  auth logout",
    "  docs list",
    "  docs search <query>",
    "  docs open <section>/<slug>",
    "  portfolio summary",
    "  agent threads",
    "  agent ask <prompt> [--thread <threadId>]",
    "  agent confirm <threadId> [--pending-bundle <bundleId>]",
    "  agent cancel <threadId> [--pending-bundle <bundleId>]",
    "  actions buy <player-name-or-id> --dollars <amount> [--thread <threadId>]",
    "  actions sell <player-name-or-id> --shares <amount> [--thread <threadId>]",
    "  actions watchlist add <player-name-or-id> [--thread <threadId>]",
    "  actions watchlist remove <player-name-or-id> [--thread <threadId>]",
    "  actions community-boost <player-name> [--timing today|tomorrow] [--thread <threadId>]",
    "  tools list",
    "  tools call <tool-name> [--args-json <json>]",
    "  prompts list",
    "  prompts render <prompt-name> [--args-json <json>]",
    "  resources list",
    "  resources read <uri>",
  ]);
}

function printCommandHelp(command) {
  const lines = COMMAND_HELP[command];
  if (!lines) {
    throw Object.assign(new Error(`Unknown command '${command}'. Run \`sportfolio --help\`.`), {
      exitCode: 1,
    });
  }

  printList(lines);
}

function ensureToken(config) {
  if (!config.token) {
    throw Object.assign(new Error("Not logged in. Run `sportfolio auth login --token <token>`."), {
      exitCode: 2,
    });
  }
}

function renderAgentResult(result) {
  const lines = [];
  const assistantMessages = (result?.result?.createdMessages || []).filter(
    (message) => message.role === "assistant",
  );
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];

  lines.push(`Thread: ${result.threadId}`);
  lines.push("");
  lines.push(lastAssistantMessage?.contentText || "No assistant response returned.");

  const pendingBundle = result?.result?.pendingActionBundle;
  if (pendingBundle) {
    lines.push("");
    lines.push(`Pending confirmation: ${pendingBundle.summary}`);
    if (pendingBundle.warnings?.length) {
      for (const warning of pendingBundle.warnings) {
        lines.push(`Warning: ${warning}`);
      }
    }
    if (pendingBundle.steps?.length) {
      lines.push("");
      lines.push("Planned steps:");
      pendingBundle.steps.forEach((step, index) => {
        lines.push(`${index + 1}. ${step.title} [${step.status}]`);
      });
    } else if (pendingBundle.actions?.length) {
      lines.push("");
      lines.push("Planned actions:");
      pendingBundle.actions.forEach((action, index) => {
        lines.push(`${index + 1}. ${action.actionType}`);
      });
    }
  }

  if (result?.result?.pendingClarification?.prompt) {
    lines.push("");
    lines.push(`Needs clarification: ${result.result.pendingClarification.prompt}`);
  }

  return lines;
}

function renderToolResult(result) {
  if (!result || typeof result !== "object") {
    return [String(result)];
  }

  const summary = typeof result.summary === "string" ? result.summary : "Tool completed.";
  const detail = { ...result };
  delete detail.summary;

  const lines = [summary];
  if (Object.keys(detail).length > 0) {
    lines.push("");
    lines.push(JSON.stringify(detail, null, 2));
  }
  return lines;
}

function formatDecimal(value, fallback = "0") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed % 1 === 0 ? String(parsed) : parsed.toFixed(2).replace(/\.?0+$/, "");
}

function formatCurrency(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function renderPortfolioSummary(result) {
  const overview =
    result &&
    typeof result === "object" &&
    result.operatorOverview &&
    typeof result.operatorOverview === "object"
      ? result.operatorOverview
      : null;

  if (!overview) {
    return renderToolResult(result);
  }

  const topHoldings = Array.isArray(overview.topHoldings) ? overview.topHoldings : [];
  const holdingCount =
    overview.portfolioPlayerCount == null
      ? topHoldings.length
      : Number(overview.portfolioPlayerCount);

  const lines = [
    `Balance: $${formatCurrency(overview.availableBalance)}`,
    `Tracked holdings: ${Number.isFinite(holdingCount) ? holdingCount : topHoldings.length}`,
  ];

  if (topHoldings.length) {
    lines.push("");
    lines.push("Top holdings:");
    for (const holding of topHoldings) {
      lines.push(
        `- ${holding.name || holding.playerName || holding.playerId}: shares ${formatDecimal(holding.shares)}, multiplier ${formatDecimal(holding.multiplier, "1")}, available ${formatDecimal(holding.availableShares)}`,
      );
    }
  }

  return lines;
}

async function listPublicTools(config) {
  return requestJson({
    baseUrl: config.baseUrl,
    path: "/api/cli/tools",
    token: config.token,
  });
}

async function callPublicTool(config, toolName, args = {}) {
  return requestJson({
    baseUrl: config.baseUrl,
    path: `/api/cli/tools/${encodeURIComponent(toolName)}`,
    method: "POST",
    token: config.token,
    body: args,
  });
}

async function listPublicPrompts(config) {
  return requestJson({
    baseUrl: config.baseUrl,
    path: "/api/cli/prompts",
    token: config.token,
  });
}

async function renderPrompt(config, promptName, args = {}) {
  return requestJson({
    baseUrl: config.baseUrl,
    path: `/api/cli/prompts/${encodeURIComponent(promptName)}/render`,
    method: "POST",
    token: config.token,
    body: args,
  });
}

async function listPublicResources(config) {
  return requestJson({
    baseUrl: config.baseUrl,
    path: "/api/cli/resources",
    token: config.token,
  });
}

async function readResource(config, uri) {
  return requestJson({
    baseUrl: config.baseUrl,
    path: `/api/cli/resources/read?uri=${encodeURIComponent(uri)}`,
    token: config.token,
  });
}

async function handleAuth(args, asJson) {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("auth");
    return;
  }

  if (subcommand === "login") {
    const token = readOption(args, "--token");
    const baseUrl = readOption(args, "--base-url");

    if (!token) {
      throw Object.assign(new Error("Missing --token value"), { exitCode: 2 });
    }

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl || loadConfig().baseUrl);
    await requestJson({
      baseUrl: normalizedBaseUrl,
      path: "/api/cli/bootstrap",
      token,
    });

    const config = loadConfig();
    saveConfig({
      ...config,
      token,
      baseUrl: normalizedBaseUrl,
    });

    const result = {
      success: true,
      configPath: getConfigPath(),
      baseUrl: normalizedBaseUrl,
    };

    if (asJson) {
      printJson(result);
      return;
    }

    printList([
      "Saved Sportfolio CLI credentials.",
      `Config: ${result.configPath}`,
      `Base URL: ${result.baseUrl}`,
    ]);
    return;
  }

  if (subcommand === "whoami") {
    const config = loadConfig();
    ensureToken(config);
    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: "/api/cli/whoami",
      token: config.token,
    });

    if (asJson) {
      printJson(result);
      return;
    }

    printList([
      `User: ${result.user.username || result.user.email || result.user.id}`,
      `Balance: $${result.user.balance}`,
      `Premium: ${result.user.isPremium ? "yes" : "no"}`,
    ]);
    return;
  }

  if (subcommand === "logout") {
    clearConfig();
    if (asJson) {
      printJson({ success: true });
      return;
    }
    printList(["Removed local Sportfolio CLI credentials."]);
    return;
  }

  throw Object.assign(new Error("Unknown auth command. Run `sportfolio auth --help`."), {
    exitCode: 1,
  });
}

async function handleDocs(args, asJson) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("docs");
    return;
  }

  if (subcommand === "list") {
    const config = loadConfig();
    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: "/api/docs/index",
    });

    if (asJson) {
      printJson(result);
      return;
    }

    printList(
      result.articles.map(
        (article) => `${article.section}/${article.slug}  ${article.title}  ${article.summary}`,
      ),
    );
    return;
  }

  if (subcommand === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      throw Object.assign(new Error("Search query is required"), { exitCode: 1 });
    }

    const config = loadConfig();
    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: `/api/docs/search?q=${encodeURIComponent(query)}`,
    });

    if (asJson) {
      printJson(result);
      return;
    }

    if (!result.results?.length) {
      printList(["No matching docs found."]);
      return;
    }

    printList(
      result.results.map(
        (entry) => `${entry.section}/${entry.slug}  ${entry.title}  [score ${entry.score}]`,
      ),
    );
    return;
  }

  if (subcommand === "open") {
    const target = rest[0] || "";
    const [section, slug] = target.split("/");

    if (!section || !slug) {
      throw Object.assign(new Error("Use `docs open <section>/<slug>`"), { exitCode: 1 });
    }

    const config = loadConfig();
    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: `/api/docs/article/${encodeURIComponent(section)}/${encodeURIComponent(slug)}`,
    });

    if (asJson) {
      printJson(result);
      return;
    }

    printList([result.article.title, result.article.summary, "", result.article.bodyMarkdown]);
    return;
  }

  throw Object.assign(new Error("Unknown docs command. Run `sportfolio docs --help`."), {
    exitCode: 1,
  });
}

async function handlePortfolio(args, asJson) {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("portfolio");
    return;
  }

  if (subcommand !== "summary") {
    throw Object.assign(
      new Error("Unknown portfolio command. Run `sportfolio portfolio --help`."),
      {
        exitCode: 1,
      },
    );
  }

  const config = loadConfig();
  ensureToken(config);
  const result = await callPublicTool(config, "get_portfolio_summary");

  if (asJson) {
    printJson(result);
    return;
  }

  printList(renderPortfolioSummary(result));
}

async function handleAgent(args, asJson) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("agent");
    return;
  }

  const config = loadConfig();
  ensureToken(config);

  if (subcommand === "threads") {
    const result = await callPublicTool(config, "list_agent_threads");

    if (asJson) {
      printJson(result);
      return;
    }

    printList(
      result.threads.map(
        (thread) =>
          `${thread.id}  ${thread.title || "(untitled)"}  ${thread.status}  ${thread.updatedAt}`,
      ),
    );
    return;
  }

  if (subcommand === "ask") {
    const threadId = readOption(rest, "--thread");
    const prompt = removeOption(rest, "--thread").join(" ").trim();
    if (!prompt) {
      throw Object.assign(new Error("Prompt is required"), { exitCode: 1 });
    }

    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: "/api/cli/agent/ask",
      method: "POST",
      token: config.token,
      body: {
        message: prompt,
        ...(threadId ? { threadId } : {}),
      },
    });

    if (asJson) {
      printJson(result);
      return;
    }

    printList(renderAgentResult(result));
    return;
  }

  if (subcommand === "confirm" || subcommand === "cancel") {
    const threadId = rest[0] || "";
    const pendingBundleId = readOption(rest, "--pending-bundle");
    if (!threadId) {
      throw Object.assign(new Error("Thread id is required"), { exitCode: 1 });
    }

    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: `/api/cli/agent/threads/${encodeURIComponent(threadId)}/${subcommand}`,
      method: "POST",
      token: config.token,
      body: pendingBundleId ? { pendingBundleId } : undefined,
    });

    if (asJson) {
      printJson(result);
      return;
    }

    const assistantMessage = result.createdMessages?.[0];
    printList([assistantMessage?.contentText || `${subcommand} completed.`]);
    return;
  }

  throw Object.assign(new Error("Unknown agent command. Run `sportfolio agent --help`."), {
    exitCode: 1,
  });
}

async function handleActions(args, asJson) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("actions");
    return;
  }

  const config = loadConfig();
  ensureToken(config);

  const threadId = readOption(rest, "--thread");
  const timing = readOption(rest, "--timing");
  const actionArgs = removeOption(removeOption(rest, "--thread"), "--timing");

  let payload = null;

  if (subcommand === "buy") {
    const player = actionArgs[0] || "";
    const dollars = Number(readOption(rest, "--dollars"));
    if (!player || !Number.isFinite(dollars) || dollars <= 0) {
      throw Object.assign(new Error("Use `actions buy <player-name-or-id> --dollars <amount>`"), {
        exitCode: 1,
      });
    }
    payload = { action: "buy", player, dollars };
  }

  if (subcommand === "sell") {
    const player = actionArgs[0] || "";
    const shares = Number(readOption(rest, "--shares"));
    if (!player || !Number.isFinite(shares) || shares <= 0) {
      throw Object.assign(new Error("Use `actions sell <player-name-or-id> --shares <amount>`"), {
        exitCode: 1,
      });
    }
    payload = { action: "sell", player, shares };
  }

  if (subcommand === "watchlist") {
    const verb = actionArgs[0] || "";
    const player = actionArgs[1] || "";
    if ((verb !== "add" && verb !== "remove") || !player) {
      throw Object.assign(new Error("Use `actions watchlist add|remove <player-name-or-id>`"), {
        exitCode: 1,
      });
    }
    payload = { action: verb === "add" ? "watchlist_add" : "watchlist_remove", player };
  }

  if (subcommand === "community-boost") {
    const player = actionArgs[0] || "";
    if (!player) {
      throw Object.assign(new Error("Use `actions community-boost <player-name>`"), {
        exitCode: 1,
      });
    }
    payload = {
      action: "community_boost",
      player,
      ...(timing ? { timing } : {}),
    };
  }

  if (!payload) {
    throw Object.assign(new Error("Unknown actions command. Run `sportfolio actions --help`."), {
      exitCode: 1,
    });
  }

  const result = await requestJson({
    baseUrl: config.baseUrl,
    path: "/api/cli/actions/stage",
    method: "POST",
    token: config.token,
    body: {
      ...payload,
      ...(threadId ? { threadId } : {}),
    },
  });

  if (asJson) {
    printJson(result);
    return;
  }

  printList(renderAgentResult(result));
}

async function handleTools(args, asJson) {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("tools");
    return;
  }

  const config = loadConfig();
  ensureToken(config);

  if (subcommand === "list") {
    const result = await listPublicTools(config);
    if (asJson) {
      printJson(result);
      return;
    }

    printList(
      result.tools.map(
        (tool) =>
          `${tool.name}  ${tool.domain}  ${tool.readOnly ? "read" : "write"}  ${tool.description}`,
      ),
    );
    return;
  }

  if (subcommand === "call") {
    const toolName = rest[0] || "";
    if (!toolName) {
      throw Object.assign(new Error("Tool name is required"), { exitCode: 1 });
    }

    const argsJson = parseJsonOption(rest, "--args-json");
    const result = await callPublicTool(config, toolName, argsJson);
    if (asJson) {
      printJson(result);
      return;
    }

    printList(renderToolResult(result));
    return;
  }

  throw Object.assign(new Error("Unknown tools command. Run `sportfolio tools --help`."), {
    exitCode: 1,
  });
}

async function handlePrompts(args, asJson) {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("prompts");
    return;
  }

  const config = loadConfig();
  ensureToken(config);

  if (subcommand === "list") {
    const result = await listPublicPrompts(config);
    if (asJson) {
      printJson(result);
      return;
    }

    printList(result.prompts.map((prompt) => `${prompt.name}  ${prompt.description}`));
    return;
  }

  if (subcommand === "render") {
    const promptName = rest[0] || "";
    if (!promptName) {
      throw Object.assign(new Error("Prompt name is required"), { exitCode: 1 });
    }

    const argsJson = parseJsonOption(rest, "--args-json");
    const result = await renderPrompt(config, promptName, argsJson);
    if (asJson) {
      printJson(result);
      return;
    }

    printList(
      (result.messages || []).map((message) => message.content?.text || JSON.stringify(message)),
    );
    return;
  }

  throw Object.assign(new Error("Unknown prompts command. Run `sportfolio prompts --help`."), {
    exitCode: 1,
  });
}

async function handleResources(args, asJson) {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printCommandHelp("resources");
    return;
  }

  const config = loadConfig();
  ensureToken(config);

  if (subcommand === "list") {
    const result = await listPublicResources(config);
    if (asJson) {
      printJson(result);
      return;
    }

    printList(result.resources.map((resource) => `${resource.uri}  ${resource.description}`));
    return;
  }

  if (subcommand === "read") {
    const uri = rest[0] || "";
    if (!uri) {
      throw Object.assign(new Error("Resource URI is required"), { exitCode: 1 });
    }

    const result = await readResource(config, uri);
    if (asJson) {
      printJson(result);
      return;
    }

    printList((result.contents || []).map((content) => content.text || ""));
    return;
  }

  throw Object.assign(new Error("Unknown resources command. Run `sportfolio resources --help`."), {
    exitCode: 1,
  });
}

export async function runCli(rawArgs) {
  const asJson = getJsonMode(rawArgs);
  const args = stripGlobalFlags(rawArgs);
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  try {
    if (rest.includes("--help")) {
      printCommandHelp(command);
      return;
    }

    if (command === "auth") {
      await handleAuth(rest, asJson);
      return;
    }

    if (command === "docs") {
      await handleDocs(rest, asJson);
      return;
    }

    if (command === "portfolio") {
      await handlePortfolio(rest, asJson);
      return;
    }

    if (command === "agent") {
      await handleAgent(rest, asJson);
      return;
    }

    if (command === "actions") {
      await handleActions(rest, asJson);
      return;
    }

    if (command === "tools") {
      await handleTools(rest, asJson);
      return;
    }

    if (command === "prompts") {
      await handlePrompts(rest, asJson);
      return;
    }

    if (command === "resources") {
      await handleResources(rest, asJson);
      return;
    }

    throw Object.assign(new Error("Unknown command. Run `sportfolio --help`."), { exitCode: 1 });
  } catch (error) {
    const exitCode =
      error && typeof error === "object" && "exitCode" in error
        ? error.exitCode
        : error && typeof error === "object" && "statusCode" in error && error.statusCode === 401
          ? 2
          : 1;
    fail(error instanceof Error ? error.message : String(error), exitCode);
  }
}
