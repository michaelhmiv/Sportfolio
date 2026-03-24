import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScoutPlanningTurn } from "./scout-agent-core";

const getActiveManagedProviderSelectionMock = vi.fn();

vi.mock("./system-settings", () => ({
  getActiveManagedProviderSelection: getActiveManagedProviderSelectionMock,
}));

type CapturedRequest = {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
};

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_DEFAULT_MODEL;
}

function buildContext() {
  return {
    generatedAt: new Date().toISOString(),
    analysisWindowMinutes: 60,
    userPromptTemplate: "Prioritize strong same-day opportunities.",
    maxScouts: 5,
    totalScouts: 0,
    remainingScouts: 5,
    defaultSport: "NBA",
    assignments: [],
    candidates: [
      {
        playerId: "player-1",
        name: "Player One",
        sport: "NBA",
        team: "AAA",
        position: "G",
        currentPrice: "10",
        lastTradePrice: "10",
        volume24h: 12,
        priceChange24h: "0.2",
        marketCap: "100",
        injuryStatus: null,
        avgFantasyPointsPerGame: "35",
        globalScoutCount: 8,
        currentScoutCount: 0,
        upcomingGame: "Tonight",
        hasGameInFocusWindow: true,
        scoutOpportunityScore: 91,
      },
    ],
    selectionWindow: null,
    recommendedTargets: [],
    knowledgeBrief: [],
  };
}

function writeChunk(res: ServerResponse, payload: Record<string, unknown> | "[DONE]") {
  const content = payload === "[DONE]" ? payload : JSON.stringify(payload);
  res.write(`data: ${content}\n\n`);
}

function streamSingleTurnToolCall(res: ServerResponse) {
  writeChunk(res, {
    id: "chatcmpl-tool-1",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "mock-model",
    choices: [{ index: 0, delta: { role: "assistant" } }],
  });
  writeChunk(res, {
    id: "chatcmpl-tool-1",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "mock-model",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: {
                name: "submit_scout_plan",
                arguments:
                  '{"replyText":"Plan is ready for your confirmation.","summary":"Mock plan","observations":[],"actions":[],"warnings":[]}',
              },
            },
          ],
        },
      },
    ],
  });
  writeChunk(res, {
    id: "chatcmpl-tool-1",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "mock-model",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  });
  writeChunk(res, {
    id: "chatcmpl-tool-1",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "mock-model",
    choices: [],
    usage: {
      prompt_tokens: 18,
      completion_tokens: 16,
      total_tokens: 34,
    },
  });
  writeChunk(res, "[DONE]");
  res.end();
}

async function startMockProviderServer() {
  const requests: CapturedRequest[] = [];

  const server = createServer(async (req, res) => {
    const bodyText = await new Promise<string>((resolve, reject) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });

    const body = bodyText.length > 0 ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

    requests.push({
      method: req.method || "GET",
      url: req.url || "",
      headers: req.headers,
      body,
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    streamSingleTurnToolCall(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  return {
    baseUrl,
    requests,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function runManagedTurn(input: { provider: "minimax"; model: string; baseUrl: string }) {
  getActiveManagedProviderSelectionMock.mockResolvedValue({
    provider: input.provider,
    modelOverride: null,
  });

  const { resolveManagedPiRuntime } = await import("./pi-provider");
  const runtime = await resolveManagedPiRuntime({
    model: input.model,
  });

  runtime.model = {
    ...runtime.model,
    baseUrl: input.baseUrl,
  };

  const result = await runScoutPlanningTurn({
    runtime,
    context: buildContext(),
    chatRequest: "Scout the top player today",
    operatorPlaybook: "Stay focused on same-day scouting opportunities.",
    strategyTemplate: "Use available scouts on the strongest active slate.",
    temperature: 0.7,
    maxTokens: 256,
  });

  return {
    result,
    runtime,
  };
}

beforeEach(() => {
  resetEnv();
  getActiveManagedProviderSelectionMock.mockReset();
});

afterEach(() => {
  resetEnv();
});

describe("scout-agent-core managed provider smoke", () => {
  it("uses minimax-safe openai payloads and completes the tool loop locally", async () => {
    process.env.MINIMAX_API_KEY = "test-minimax";
    process.env.MINIMAX_DEFAULT_MODEL = "MiniMax-M2.7";
    const server = await startMockProviderServer();

    try {
      const { result } = await runManagedTurn({
        provider: "minimax",
        model: "MiniMax-M2.7",
        baseUrl: server.baseUrl,
      });

      expect(result.output.summary).toBe("Mock plan");
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0].headers.authorization).toBe("Bearer test-minimax");
      expect(server.requests[0].body.reasoning_split).toBe(true);
      expect(server.requests[0].body.max_tokens).toBe(256);
      expect(server.requests[0].body.max_completion_tokens).toBeUndefined();
      expect(server.requests[0].body.stream_options).toBeUndefined();
      expect(server.requests[0].body.store).toBeUndefined();
      expect(
        ((server.requests[0].body.messages as Array<{ role: string }> | undefined) || [])[0]?.role,
      ).toBe("system");
      expect(
        (
          ((server.requests[0].body.tools as Array<{
            function?: Record<string, unknown>;
          }>) || [])[0]?.function || {}
        ).strict,
      ).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
