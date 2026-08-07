import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "sportfolio-cli-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { runCli } = await import("../packages/sportfolio-cli/src/index.mjs");

const transactionId = "00000000-0000-4000-8000-000000000001";

function createStagedResult(summary) {
  return {
    summary,
    transactionId,
    warnings: [],
    confirmationRequired: true,
    transaction: {
      transactionId,
      status: "pending_confirmation",
      summary,
      warnings: [],
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
  const body = rawBody ? JSON.parse(rawBody) : {};

  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/api/cli/bootstrap") {
    res.end(
      JSON.stringify({
        user: { id: "user_1", username: "cli_user", email: "cli@example.com" },
        capabilities: { canAnalyze: true },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/whoami") {
    res.end(
      JSON.stringify({
        summary: "Loaded authenticated account profile.",
        user: {
          id: "user_1",
          username: "cli_user",
          email: "cli@example.com",
          balance: "1234.56",
          isPremium: true,
        },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/docs/index") {
    res.end(
      JSON.stringify({
        articles: [
          {
            section: "gameplay",
            slug: "player-pools",
            title: "Player Pools",
            summary: "How AMM trading works.",
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/docs/search") {
    res.end(
      JSON.stringify({
        results: [
          {
            section: "gameplay",
            slug: "player-pools",
            title: "Player Pools",
            score: 7,
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/docs/article/gameplay/player-pools") {
    res.end(
      JSON.stringify({
        article: {
          title: "Player Pools",
          summary: "How AMM trading works.",
          bodyMarkdown: "# Player Pools\n\nAMM-backed markets.",
        },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/tools") {
    res.end(
      JSON.stringify({
        tools: [
          {
            name: "get_account_profile",
            domain: "account",
            readOnly: true,
            description: "Load the authenticated user's core account profile.",
          },
          {
            name: "get_portfolio_summary",
            domain: "portfolio",
            readOnly: true,
            description: "Load a portfolio summary.",
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/tools/get_account_profile") {
    res.end(
      JSON.stringify({
        summary: "Loaded authenticated account profile.",
        user: {
          id: "user_1",
          username: "cli_user",
          email: "cli@example.com",
          balance: "1234.56",
          isPremium: true,
        },
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/tools/get_portfolio_summary") {
    res.end(
      JSON.stringify({
        summary: "Loaded portfolio summary.",
        portfolio: {
          balance: "1234.56",
          holdingCount: 2,
        },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/prompts") {
    res.end(
      JSON.stringify({
        prompts: [
          {
            name: "find_boost_candidates",
            description: "Prompt starter for boost candidate discovery.",
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/prompts/find_boost_candidates/render") {
    res.end(
      JSON.stringify({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Find the best boost candidates.",
            },
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/resources") {
    res.end(
      JSON.stringify({
        resources: [
          {
            uri: "sportfolio://docs/index",
            description: "Published Sportfolio documentation article index.",
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/resources/read") {
    res.end(
      JSON.stringify({
        contents: [
          {
            uri: url.searchParams.get("uri"),
            text: JSON.stringify({
              articles: [
                {
                  section: "gameplay",
                  slug: "player-pools",
                  title: "Player Pools",
                  summary: "How AMM trading works.",
                },
              ],
            }),
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/actions/stage") {
    res.end(JSON.stringify(createStagedResult(`Staged ${body.action}`)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/tools/confirm_pending_action") {
    res.end(JSON.stringify({ summary: "Confirmed gameplay transaction.", transactionId }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/tools/cancel_pending_action") {
    res.end(JSON.stringify({ summary: "Cancelled gameplay transaction.", transactionId }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ message: `Unhandled route: ${req.method} ${url.pathname}` }));
});

const port = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(address.port);
  });
});

async function invoke(args) {
  let stdout = "";
  let stderr = "";
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalExitCode = process.exitCode;

  process.stdout.write = (chunk, encoding, callback) => {
    stdout += String(chunk);
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    stderr += String(chunk);
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };
  process.exitCode = 0;

  try {
    await runCli(args);
  } finally {
    const exitCode = process.exitCode || 0;
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    process.exitCode = originalExitCode;
    return { stdout, stderr, exitCode };
  }
}

const baseUrl = `http://127.0.0.1:${port}`;
const validToken = `spt_aaaaaaaaaaaa_${"b".repeat(48)}`;

try {
  let result = await invoke(["auth", "login", "--token", validToken, "--base-url", baseUrl]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Saved Sportfolio CLI credentials/);

  result = await invoke(["auth", "whoami"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /cli_user/);

  result = await invoke(["docs", "list"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Player Pools/);

  result = await invoke(["docs", "search", "pools"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /score 7/);

  result = await invoke(["docs", "open", "gameplay/player-pools"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /AMM-backed markets/);

  result = await invoke(["portfolio", "summary"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Loaded portfolio summary/);

  result = await invoke(["actions", "buy", "nba_1", "--dollars", "25"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged buy/);

  result = await invoke(["actions", "sell", "nba_1", "--shares", "2"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged sell/);

  result = await invoke(["actions", "community-boost", "nba_1", "--timing", "tomorrow"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged community_boost/);

  result = await invoke(["actions", "confirm", transactionId]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Confirmed gameplay transaction/);

  result = await invoke(["actions", "cancel", transactionId]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Cancelled gameplay transaction/);

  result = await invoke(["tools", "list"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /get_account_profile/);

  result = await invoke(["tools", "call", "get_account_profile"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Loaded authenticated account profile/);

  result = await invoke(["prompts", "list"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /find_boost_candidates/);

  result = await invoke(["prompts", "render", "find_boost_candidates"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Find the best boost candidates/);

  result = await invoke(["resources", "list"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /sportfolio:\/\/docs\/index/);

  result = await invoke(["resources", "read", "sportfolio://docs/index"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Player Pools/);

  console.log("[cli:smoke] All CLI commands completed successfully.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
