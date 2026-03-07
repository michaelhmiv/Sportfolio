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
    "  agent confirm <threadId>",
    "  agent cancel <threadId>",
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
    "  actions vesting claim [--thread <threadId>]",
    "  actions community-boost <player-name> [--timing today|tomorrow] [--thread <threadId>]",
    "",
    "Notes:",
    "  - Action commands stage a plan and still require explicit confirm.",
    "  - For community boosts, prefer full player names for best resolution.",
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
    "  agent confirm <threadId>",
    "  agent cancel <threadId>",
    "  actions buy <player-name-or-id> --dollars <amount> [--thread <threadId>]",
    "  actions sell <player-name-or-id> --shares <amount> [--thread <threadId>]",
    "  actions watchlist add <player-name-or-id> [--thread <threadId>]",
    "  actions watchlist remove <player-name-or-id> [--thread <threadId>]",
    "  actions vesting claim [--thread <threadId>]",
    "  actions community-boost <player-name> [--timing today|tomorrow] [--thread <threadId>]",
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

    if (!result.results.length) {
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
  const result = await requestJson({
    baseUrl: config.baseUrl,
    path: "/api/cli/portfolio/summary",
    token: config.token,
  });

  if (asJson) {
    printJson(result);
    return;
  }

  const lines = [
    `Balance: $${result.summary.balance}`,
    `Tracked holdings: ${result.summary.holdingCount}`,
  ];

  if (result.summary.vesting) {
    lines.push(`Vesting shares: ${result.summary.vesting.sharesAccumulated}`);
  }

  if (result.summary.topHoldings.length) {
    lines.push("");
    lines.push("Top holdings:");
    for (const holding of result.summary.topHoldings) {
      lines.push(
        `- ${holding.playerName}: qty ${holding.quantity}, power ${holding.powerLevel}, locked ${holding.lockedQuantity}`,
      );
    }
  }

  printList(lines);
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
    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: "/api/cli/agent/threads",
      token: config.token,
    });

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
    if (!threadId) {
      throw Object.assign(new Error("Thread id is required"), { exitCode: 1 });
    }

    const result = await requestJson({
      baseUrl: config.baseUrl,
      path: `/api/cli/agent/threads/${encodeURIComponent(threadId)}/${subcommand}`,
      method: "POST",
      token: config.token,
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

  if (subcommand === "vesting") {
    const verb = actionArgs[0] || "";
    if (verb !== "claim") {
      throw Object.assign(new Error("Use `actions vesting claim`"), { exitCode: 1 });
    }
    payload = { action: "vesting_claim" };
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

export async function runCli(rawArgs) {
  const asJson = getJsonMode(rawArgs);
  const args = stripGlobalFlags(rawArgs);
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (rest.includes("--help")) {
    printCommandHelp(command);
    return;
  }

  try {
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
