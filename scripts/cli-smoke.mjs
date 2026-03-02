import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "sportfolio-cli-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { runCli } = await import("../packages/sportfolio-cli/src/index.mjs");

function createWrappedResult(summary) {
  return {
    threadId: "thread_demo",
    createdThread: false,
    result: {
      thread: {
        id: "thread_demo",
        title: "CLI thread",
        channel: "in_app",
        domain: "sportfolio",
        status: "active",
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastMessagePreview: summary,
        pendingActionBundle: null,
      },
      createdMessages: [
        {
          id: "msg_assistant",
          role: "assistant",
          messageType: "plan",
          contentText: summary,
          createdAt: new Date().toISOString(),
          runId: "run_demo",
          actionBundle: null,
          citations: [],
          pendingClarification: null,
        },
      ],
      pendingActionBundle: {
        id: "bundle_demo",
        status: "pending_confirmation",
        domain: "sportfolio",
        summary,
        warnings: [],
        actions: [{ actionType: "cli_demo" }],
        workflowType: "single_action",
        steps: [{ id: "step_1", title: summary, status: "pending", action: null }],
        runId: "run_demo",
        createdAt: new Date().toISOString(),
        confirmedAt: null,
        appliedAt: null,
      },
      pendingClarification: null,
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

  if (req.method === "GET" && url.pathname === "/api/cli/portfolio/summary") {
    res.end(
      JSON.stringify({
        summary: {
          balance: "1234.56",
          holdingCount: 2,
          topHoldings: [
            {
              playerName: "Demo Player",
              quantity: "4",
              powerLevel: "8",
              lockedQuantity: 1,
            },
          ],
          vesting: {
            sharesAccumulated: 120,
          },
        },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/agent/threads") {
    res.end(
      JSON.stringify({
        threads: [
          {
            id: "thread_demo",
            title: "CLI thread",
            status: "active",
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/agent/ask") {
    res.end(JSON.stringify(createWrappedResult(`Planned: ${body.message}`)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cli/actions/stage") {
    res.end(JSON.stringify(createWrappedResult(`Staged ${body.action}`)));
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/confirm")) {
    res.end(
      JSON.stringify({
        createdMessages: [{ contentText: "Confirmed pending bundle." }],
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/cancel")) {
    res.end(
      JSON.stringify({
        createdMessages: [{ contentText: "Cancelled pending bundle." }],
      }),
    );
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
  assert.match(result.stdout, /Balance: \$1234.56/);

  result = await invoke(["agent", "threads"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /thread_demo/);

  result = await invoke(["agent", "ask", "review", "my", "setup"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Pending confirmation/);

  result = await invoke(["agent", "confirm", "thread_demo"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Confirmed pending bundle/);

  result = await invoke(["agent", "cancel", "thread_demo"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Cancelled pending bundle/);

  result = await invoke(["actions", "buy", "nba_1", "--dollars", "25"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged buy/);

  result = await invoke(["actions", "sell", "nba_1", "--shares", "2"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged sell/);

  result = await invoke(["actions", "watchlist", "add", "nba_1"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged watchlist_add/);

  result = await invoke(["actions", "watchlist", "remove", "nba_1"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged watchlist_remove/);

  result = await invoke(["actions", "vesting", "claim"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged vesting_claim/);

  result = await invoke(["actions", "community-boost", "nba_1", "--timing", "tomorrow"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Staged community_boost/);

  console.log("[cli:smoke] All CLI commands completed successfully.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
