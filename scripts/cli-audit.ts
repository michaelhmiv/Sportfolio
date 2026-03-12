import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  buildPublicPromptRegistry,
  buildPublicResourceRegistry,
  buildPublicToolRegistry,
  executePublicTool,
  getPublicPromptFixtures,
  getPublicToolFixtures,
  readPublicResource,
  renderPublicPrompt,
} from "../server/mcp/public-tool-registry";
import { createMockPublicMcpDependencies } from "../server/mcp/testing";

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "sportfolio-cli-audit-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { runCli } = await import("../packages/sportfolio-cli/src/index.mjs");

const harness = createMockPublicMcpDependencies();
const context = {
  userId: harness.userId,
  deps: harness.deps,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "";
  const body =
    rawBody && req.headers["content-type"]?.includes("application/json") ? JSON.parse(rawBody) : {};

  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/api/cli/bootstrap") {
    res.end(
      JSON.stringify({
        user: harness.state.user,
        capabilities: await harness.deps.getAgentCapabilities(harness.userId),
        docs: {
          indexUrl: "/api/docs/index",
          searchUrl: "/api/docs/search",
        },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/tools") {
    res.end(
      JSON.stringify({
        tools: buildPublicToolRegistry().map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          domain: tool.domain,
          readOnly: tool.readOnly,
          inputKeys: Object.keys(tool.inputSchema || {}),
          fixtureArgs: tool.fixtureArgs,
        })),
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cli/tools/")) {
    const toolName = decodeURIComponent(url.pathname.replace("/api/cli/tools/", ""));
    res.end(JSON.stringify(await executePublicTool(context, toolName, body)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/prompts") {
    res.end(
      JSON.stringify({
        prompts: buildPublicPromptRegistry().map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          inputKeys: Object.keys(prompt.argsSchema || {}),
          fixtureArgs: prompt.fixtureArgs,
        })),
      }),
    );
    return;
  }

  if (req.method === "POST" && /\/api\/cli\/prompts\/.+\/render$/.test(url.pathname)) {
    const promptName = decodeURIComponent(
      url.pathname.replace("/api/cli/prompts/", "").replace("/render", ""),
    );
    res.end(JSON.stringify(await renderPublicPrompt(promptName, body)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/resources") {
    res.end(
      JSON.stringify({
        resources: buildPublicResourceRegistry(context).map((resource) => ({
          id: resource.id,
          uri: resource.uri,
          mimeType: resource.mimeType,
          description: resource.description,
        })),
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cli/resources/read") {
    const uri = url.searchParams.get("uri") || "";
    res.end(JSON.stringify(await readPublicResource(context, uri)));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ message: `Unhandled route: ${req.method} ${url.pathname}` }));
});

const port = await new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address === "object" && "port" in address);
    resolve(address.port);
  });
});

async function invoke(rawArgs: string[]) {
  let stdout = "";
  let stderr = "";
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalExitCode = process.exitCode;

  process.stdout.write = ((
    chunk: string | Uint8Array,
    _encoding?: BufferEncoding,
    callback?: () => void,
  ) => {
    stdout += String(chunk);
    callback?.();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((
    chunk: string | Uint8Array,
    _encoding?: BufferEncoding,
    callback?: () => void,
  ) => {
    stderr += String(chunk);
    callback?.();
    return true;
  }) as typeof process.stderr.write;
  process.exitCode = 0;
  let exitCode = 0;

  try {
    await runCli(rawArgs);
  } finally {
    exitCode = process.exitCode || 0;
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    process.exitCode = originalExitCode;
  }

  return {
    stdout,
    stderr,
    exitCode,
  };
}

const baseUrl = `http://127.0.0.1:${port}`;
const validToken = `spt_aaaaaaaaaaaa_${"b".repeat(48)}`;
const toolFixtures = getPublicToolFixtures();
const promptFixtures = getPublicPromptFixtures();
let activeThreadId = "thread_1";
let activePendingBundleId = "bundle_1";

async function ensurePendingBundle() {
  if (activePendingBundleId) {
    return;
  }

  const staged = await executePublicTool(context, "stage_market_buy", {
    playerId: "player_1",
    amount: 25,
  });
  activeThreadId = String(staged.threadId || activeThreadId);
  activePendingBundleId = String(staged.pendingBundleId || "");
}

function resolveToolArgs(toolName: string) {
  const args = { ...(toolFixtures[toolName] || {}) };

  if (
    [
      "get_thread_state",
      "list_thread_messages",
      "list_thread_research_sources",
      "get_pending_action",
      "send_agent_message",
    ].includes(toolName)
  ) {
    args.threadId = activeThreadId;
  }

  if (toolName === "send_agent_message") {
    args.message = "stage preview_pool_buy player_1";
  }

  if (toolName === "confirm_pending_action" || toolName === "cancel_pending_action") {
    args.threadId = activeThreadId;
    args.pendingBundleId = activePendingBundleId;
  }

  return args;
}

try {
  let result = await invoke(["auth", "login", "--token", validToken, "--base-url", baseUrl]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);

  result = await invoke(["--json", "tools", "list"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const listedTools = JSON.parse(result.stdout);
  assert.equal(listedTools.tools.length, buildPublicToolRegistry().length);

  for (const tool of buildPublicToolRegistry()) {
    if (tool.name === "confirm_pending_action" || tool.name === "cancel_pending_action") {
      await ensurePendingBundle();
    }

    result = await invoke([
      "--json",
      "tools",
      "call",
      tool.name,
      "--args-json",
      JSON.stringify(resolveToolArgs(tool.name)),
    ]);
    assert.equal(result.exitCode, 0, `${tool.name}: ${result.stderr || result.stdout}`);
    const parsedResult = JSON.parse(result.stdout);
    if (parsedResult.threadId) {
      activeThreadId = String(parsedResult.threadId);
    } else if (parsedResult.thread?.id) {
      activeThreadId = String(parsedResult.thread.id);
    }
    if (parsedResult.pendingBundleId) {
      activePendingBundleId = String(parsedResult.pendingBundleId);
    }
    if (tool.name === "confirm_pending_action" || tool.name === "cancel_pending_action") {
      activePendingBundleId = "";
    }
  }

  result = await invoke(["--json", "prompts", "list"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const listedPrompts = JSON.parse(result.stdout);
  assert.equal(listedPrompts.prompts.length, buildPublicPromptRegistry().length);

  for (const prompt of buildPublicPromptRegistry()) {
    result = await invoke([
      "--json",
      "prompts",
      "render",
      prompt.name,
      "--args-json",
      JSON.stringify(promptFixtures[prompt.name]),
    ]);
    assert.equal(result.exitCode, 0, `${prompt.name}: ${result.stderr || result.stdout}`);
    JSON.parse(result.stdout);
  }

  result = await invoke(["--json", "resources", "list"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const listedResources = JSON.parse(result.stdout);
  const resources = buildPublicResourceRegistry(context);
  assert.equal(listedResources.resources.length, resources.length);

  for (const resource of resources) {
    result = await invoke(["--json", "resources", "read", resource.uri]);
    assert.equal(result.exitCode, 0, `${resource.uri}: ${result.stderr || result.stdout}`);
    JSON.parse(result.stdout);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        toolCount: buildPublicToolRegistry().length,
        promptCount: buildPublicPromptRegistry().length,
        resourceCount: resources.length,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
