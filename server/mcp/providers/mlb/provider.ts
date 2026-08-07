import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const CURATED_MLB_TOOL_NAMES = [
  "search_mlb_players",
  "get_mlb_batting_leaders",
  "get_mlb_pitching_leaders",
  "get_mlb_player_stats",
  "get_mlb_player_splits",
  "get_mlb_team_leaders",
  "get_mlb_games",
  "get_mlb_game_details",
  "get_mlb_probable_pitchers",
  "get_mlb_standings",
  "get_mlb_roster",
  "get_mlb_statcast_profile",
] as const;

export type CuratedMlbToolName = (typeof CURATED_MLB_TOOL_NAMES)[number];
export type MlbProviderErrorCode =
  | "provider_disabled"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_protocol_error"
  | "provider_missing_tool"
  | "provider_invalid_request"
  | "provider_upstream_error"
  | "provider_response_limit";

export class MlbProviderError extends Error {
  constructor(
    readonly code: MlbProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MlbProviderError";
  }
}

export type MlbProviderConfig = {
  enabled: boolean;
  endpoint: string | null;
  timeoutMs: number;
  healthCacheMs: number;
  authBearerToken: string | null;
  maxResponseChars: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
};

type RemoteInvocation = { remoteTool: string; args: Record<string, unknown> };
type ToolCatalog = Set<string>;
type ProviderHealth = {
  configured: boolean;
  reachable: boolean;
  checkedAt: string | null;
  requiredCapabilityCount: number;
  availableCapabilityCount: number;
  circuitOpen: boolean;
  lastErrorCode: MlbProviderErrorCode | null;
};

type ClientLike = {
  connect(): Promise<void>;
  listTools(): Promise<{ tools?: Array<{ name?: string }> }>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
};

type ProviderRuntime = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  createClient: (config: MlbProviderConfig, signal: AbortSignal) => ClientLike;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_HEALTH_CACHE_MS = 60_000;
const DEFAULT_RESPONSE_LIMIT = 150_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_RESET_MS = 30_000;
const REQUIRED_REMOTE_TOOLS = new Set([
  "lookup_player",
  "get_league_leader_data",
  "get_player_stats",
  "get_player_splits",
  "get_team_leaders",
  "get_schedule",
  "get_boxscore",
  "get_standings",
  "get_team_roster",
  "get_statcast_batter_expected_stats",
  "get_statcast_pitcher_expected_stats",
]);

let cachedCatalog: { tools: ToolCatalog; expiresAt: number; checkedAt: number } | null = null;
let consecutiveTransientFailures = 0;
let circuitOpenedAt = 0;
let lastErrorCode: MlbProviderErrorCode | null = null;

function parseBoolean(value: string | undefined): boolean | null {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeEndpoint(value: string | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (url.pathname === "/" || !url.pathname) url.pathname = "/mcp";
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveMlbProviderConfig(): MlbProviderConfig {
  const endpoint = normalizeEndpoint(process.env.MLB_MCP_URL);
  const explicitEnabled = parseBoolean(process.env.MLB_MCP_ENABLED);
  return {
    enabled: explicitEnabled ?? Boolean(endpoint),
    endpoint,
    timeoutMs: parseBoundedInt(process.env.MLB_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 2_000, 120_000),
    healthCacheMs: parseBoundedInt(
      process.env.MLB_MCP_HEALTH_CACHE_MS,
      DEFAULT_HEALTH_CACHE_MS,
      5_000,
      600_000,
    ),
    authBearerToken: process.env.MLB_MCP_AUTH_BEARER?.trim() || null,
    maxResponseChars: parseBoundedInt(
      process.env.MLB_MCP_MAX_RESPONSE_CHARS,
      DEFAULT_RESPONSE_LIMIT,
      8_000,
      1_000_000,
    ),
    circuitFailureThreshold: parseBoundedInt(
      process.env.MLB_MCP_CIRCUIT_FAILURE_THRESHOLD,
      DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
      2,
      10,
    ),
    circuitResetMs: parseBoundedInt(
      process.env.MLB_MCP_CIRCUIT_RESET_MS,
      DEFAULT_CIRCUIT_RESET_MS,
      5_000,
      300_000,
    ),
  };
}

function defaultCreateClient(config: MlbProviderConfig, signal: AbortSignal): ClientLike {
  if (!config.endpoint) {
    throw new MlbProviderError(
      "provider_unavailable",
      "MLB provider endpoint is not configured.",
      true,
    );
  }
  const headers: Record<string, string> = {};
  if (config.authBearerToken) headers.authorization = `Bearer ${config.authBearerToken}`;
  const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
    requestInit: { headers, signal },
  });
  const client = new Client({ name: "sportfolio-mlb-provider", version: "1.0.0" });
  return {
    connect: () => client.connect(transport),
    listTools: () => client.listTools() as Promise<{ tools?: Array<{ name?: string }> }>,
    callTool: (input) => client.callTool(input),
    close: () => client.close(),
  };
}

const defaultRuntime: ProviderRuntime = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createClient: defaultCreateClient,
};

function redact(value: string, token: string | null): string {
  let output = value;
  if (token) output = output.split(token).join("[REDACTED]");
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  return output;
}

function normalizeError(error: unknown, config: MlbProviderConfig): MlbProviderError {
  if (error instanceof MlbProviderError) return error;
  const message = redact(
    error instanceof Error ? error.message : String(error),
    config.authBearerToken,
  );
  if (/abort|timeout|timed out/i.test(message)) {
    return new MlbProviderError("provider_timeout", "MLB provider request timed out.", true);
  }
  return new MlbProviderError(
    "provider_unavailable",
    `MLB provider is unavailable: ${message}`,
    true,
  );
}

async function withTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new MlbProviderError("provider_timeout", "MLB provider request timed out.", true));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isCircuitOpen(config: MlbProviderConfig, runtime: ProviderRuntime) {
  if (!circuitOpenedAt) return false;
  if (runtime.now() - circuitOpenedAt >= config.circuitResetMs) {
    circuitOpenedAt = 0;
    consecutiveTransientFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess() {
  consecutiveTransientFailures = 0;
  circuitOpenedAt = 0;
  lastErrorCode = null;
}

function recordFailure(
  error: MlbProviderError,
  config: MlbProviderConfig,
  runtime: ProviderRuntime,
) {
  lastErrorCode = error.code;
  if (!error.retryable) return;
  consecutiveTransientFailures += 1;
  if (consecutiveTransientFailures >= config.circuitFailureThreshold) {
    circuitOpenedAt = runtime.now();
  }
}

async function useClient<T>(
  config: MlbProviderConfig,
  runtime: ProviderRuntime,
  callback: (client: ClientLike) => Promise<T>,
): Promise<T> {
  return withTimeout(config.timeoutMs, async (signal) => {
    const client = runtime.createClient(config, signal);
    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  });
}

async function discoverTools(
  config: MlbProviderConfig,
  runtime: ProviderRuntime,
  force = false,
): Promise<ToolCatalog> {
  if (!force && cachedCatalog && cachedCatalog.expiresAt > runtime.now())
    return new Set(cachedCatalog.tools);
  const result = await useClient(config, runtime, (client) => client.listTools());
  if (!result || !Array.isArray(result.tools)) {
    throw new MlbProviderError(
      "provider_protocol_error",
      "MLB provider returned an invalid tool catalog.",
      true,
    );
  }
  const tools = new Set(
    result.tools
      .map((entry) => (typeof entry?.name === "string" ? entry.name.trim() : ""))
      .filter(Boolean),
  );
  cachedCatalog = {
    tools,
    checkedAt: runtime.now(),
    expiresAt: runtime.now() + config.healthCacheMs,
  };
  return tools;
}

function numberArg(value: unknown, name: string, min: number, max: number, fallback?: number) {
  if (value == null && fallback != null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    throw new MlbProviderError(
      "provider_invalid_request",
      `${name} must be an integer between ${min} and ${max}.`,
      false,
    );
  }
  return number;
}

function stringArg(value: unknown, name: string, required = true) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) {
    throw new MlbProviderError("provider_invalid_request", `${name} is required.`, false);
  }
  return text;
}

const BATTING_METRICS: Record<string, string> = {
  avg: "battingAverage",
  obp: "onBasePercentage",
  slg: "sluggingPercentage",
  ops: "onBasePlusSlugging",
  home_runs: "homeRuns",
  rbi: "runsBattedIn",
  runs: "runs",
  hits: "hits",
  stolen_bases: "stolenBases",
  war: "winsAboveReplacement",
};
const PITCHING_METRICS: Record<string, string> = {
  era: "earnedRunAverage",
  wins: "wins",
  strikeouts: "strikeouts",
  whip: "walksAndHitsPerInningPitched",
  saves: "saves",
  innings: "inningsPitched",
  war: "winsAboveReplacement",
};

function mapInvocation(tool: CuratedMlbToolName, args: Record<string, unknown>): RemoteInvocation {
  const currentSeason = new Date().getUTCFullYear();
  switch (tool) {
    case "search_mlb_players":
      return {
        remoteTool: "lookup_player",
        args: { name: stringArg(args.query ?? args.name, "query") },
      };
    case "get_mlb_batting_leaders": {
      const metric = stringArg(args.metric ?? "ops", "metric");
      const category = BATTING_METRICS[metric];
      if (!category)
        throw new MlbProviderError(
          "provider_invalid_request",
          `Unsupported batting metric: ${metric}.`,
          false,
        );
      return {
        remoteTool: "get_league_leader_data",
        args: {
          leader_categories: category,
          stat_group: "hitting",
          season: numberArg(args.season, "season", 1876, currentSeason + 1, currentSeason),
          limit: numberArg(args.limit, "limit", 1, 100, 10),
          league: stringArg(args.league ?? "mlb", "league"),
          qualification: stringArg(args.qualification ?? "qualified", "qualification"),
        },
      };
    }
    case "get_mlb_pitching_leaders": {
      const metric = stringArg(args.metric ?? "era", "metric");
      const category = PITCHING_METRICS[metric];
      if (!category)
        throw new MlbProviderError(
          "provider_invalid_request",
          `Unsupported pitching metric: ${metric}.`,
          false,
        );
      return {
        remoteTool: "get_league_leader_data",
        args: {
          leader_categories: category,
          stat_group: "pitching",
          season: numberArg(args.season, "season", 1876, currentSeason + 1, currentSeason),
          limit: numberArg(args.limit, "limit", 1, 100, 10),
          league: stringArg(args.league ?? "mlb", "league"),
          qualification: stringArg(args.qualification ?? "qualified", "qualification"),
        },
      };
    }
    case "get_mlb_player_stats":
      return {
        remoteTool: "get_player_stats",
        args: {
          player_id: numberArg(args.playerId ?? args.player_id, "playerId", 1, 99_999_999),
          group: stringArg(args.group ?? "hitting", "group"),
          season: numberArg(args.season, "season", 1876, currentSeason + 1, currentSeason),
          stats: stringArg(args.stats ?? "season", "stats"),
        },
      };
    case "get_mlb_player_splits":
      return {
        remoteTool: "get_player_splits",
        args: {
          playerid: stringArg(args.playerId ?? args.playerid, "playerId"),
          year: numberArg(
            args.season ?? args.year,
            "season",
            1876,
            currentSeason + 1,
            currentSeason,
          ),
        },
      };
    case "get_mlb_team_leaders":
      return {
        remoteTool: "get_team_leaders",
        args: {
          team_id: numberArg(args.teamId ?? args.team_id, "teamId", 1, 9999),
          season: numberArg(args.season, "season", 1876, currentSeason + 1, currentSeason),
          leader_category: stringArg(args.metric ?? args.leaderCategory, "metric"),
          limit: numberArg(args.limit, "limit", 1, 100, 10),
        },
      };
    case "get_mlb_games": {
      const date = stringArg(args.date, "date");
      return { remoteTool: "get_schedule", args: { start_date: date, end_date: date } };
    }
    case "get_mlb_game_details":
      return {
        remoteTool: "get_boxscore",
        args: { game_id: numberArg(args.gameId ?? args.game_id, "gameId", 1, 99_999_999) },
      };
    case "get_mlb_probable_pitchers": {
      const date = stringArg(args.date, "date");
      return { remoteTool: "get_schedule", args: { start_date: date, end_date: date } };
    }
    case "get_mlb_standings":
      return {
        remoteTool: "get_standings",
        args: {
          season: numberArg(args.season, "season", 1876, currentSeason + 1, currentSeason),
          standings_types: stringArg(args.type ?? "regularSeason", "type"),
        },
      };
    case "get_mlb_roster":
      return {
        remoteTool: "get_team_roster",
        args: {
          team_id: numberArg(args.teamId ?? args.team_id, "teamId", 1, 9999),
          roster_type: stringArg(args.rosterType ?? "active", "rosterType"),
          season: numberArg(args.season, "season", 1876, currentSeason + 1, currentSeason),
        },
      };
    case "get_mlb_statcast_profile": {
      const role = stringArg(args.role ?? "batter", "role");
      if (!["batter", "pitcher"].includes(role))
        throw new MlbProviderError(
          "provider_invalid_request",
          "role must be batter or pitcher.",
          false,
        );
      return {
        remoteTool:
          role === "pitcher"
            ? "get_statcast_pitcher_expected_stats"
            : "get_statcast_batter_expected_stats",
        args: {
          year: numberArg(
            args.season ?? args.year,
            "season",
            2008,
            currentSeason + 1,
            currentSeason,
          ),
          minPA: numberArg(args.minimum ?? args.minPA, "minimum", 0, 1000, 50),
        },
      };
    }
  }
}

function extractPayload(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (record.isError) {
    const text = Array.isArray(record.content)
      ? record.content
          .filter((part): part is { type: string; text: string } =>
            Boolean(
              part &&
              typeof part === "object" &&
              (part as any).type === "text" &&
              typeof (part as any).text === "string",
            ),
          )
          .map((part) => part.text)
          .join("\n")
      : "";
    throw new MlbProviderError(
      "provider_upstream_error",
      text || "MLB provider returned an error.",
      true,
    );
  }
  return record.structuredContent ?? record;
}

function assertResponseSize(payload: unknown, config: MlbProviderConfig) {
  const serialized = JSON.stringify(payload);
  if (serialized.length > config.maxResponseChars) {
    throw new MlbProviderError(
      "provider_response_limit",
      `MLB provider response exceeded ${config.maxResponseChars} characters.`,
      false,
      { responseChars: serialized.length },
    );
  }
  return payload;
}

export async function callMlbPublicTool(
  publicTool: CuratedMlbToolName,
  args: Record<string, unknown>,
  options: { requestId?: string; config?: MlbProviderConfig; runtime?: ProviderRuntime } = {},
): Promise<Record<string, unknown>> {
  const config = options.config ?? resolveMlbProviderConfig();
  const runtime = options.runtime ?? defaultRuntime;
  const requestId = options.requestId ?? randomUUID();
  const startedAt = runtime.now();
  if (!config.enabled)
    throw new MlbProviderError("provider_disabled", "MLB data provider is disabled.", false);
  if (!config.endpoint)
    throw new MlbProviderError(
      "provider_unavailable",
      "MLB data provider is not configured.",
      true,
    );
  if (isCircuitOpen(config, runtime)) {
    throw new MlbProviderError(
      "provider_unavailable",
      "MLB data provider circuit is temporarily open.",
      true,
      { circuitOpen: true },
    );
  }
  const invocation = mapInvocation(publicTool, args);

  let lastError: MlbProviderError | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const catalog = await discoverTools(config, runtime, attempt > 1);
      if (!catalog.has(invocation.remoteTool)) {
        throw new MlbProviderError(
          "provider_missing_tool",
          `MLB provider is missing required capability ${invocation.remoteTool}.`,
          false,
          { remoteTool: invocation.remoteTool },
        );
      }
      const result = await useClient(config, runtime, (client) =>
        client.callTool({ name: invocation.remoteTool, arguments: invocation.args }),
      );
      const payload = assertResponseSize(extractPayload(result), config);
      recordSuccess();
      const outputBytes = Buffer.byteLength(JSON.stringify(payload));
      console.info("[mlb-mcp] invocation", {
        requestId,
        publicTool,
        remoteTool: invocation.remoteTool,
        status: "success",
        durationMs: runtime.now() - startedAt,
        outputBytes,
        attempt,
      });
      return {
        summary: `Loaded MLB data for ${publicTool}.`,
        data: payload,
        warnings: [],
        provider: { name: "mlb-mcp", remoteTool: invocation.remoteTool, requestId },
      };
    } catch (error) {
      const normalized = normalizeError(error, config);
      lastError = normalized;
      recordFailure(normalized, config, runtime);
      if (!normalized.retryable || attempt === 2 || isCircuitOpen(config, runtime)) break;
      cachedCatalog = null;
      await runtime.sleep(25);
    }
  }

  const error =
    lastError ?? new MlbProviderError("provider_unavailable", "MLB provider is unavailable.", true);
  console.warn("[mlb-mcp] invocation", {
    requestId,
    publicTool,
    remoteTool: invocation.remoteTool,
    status: "error",
    durationMs: runtime.now() - startedAt,
    errorCode: error.code,
    retryable: error.retryable,
  });
  throw error;
}

export async function getMlbProviderHealth(
  options: { config?: MlbProviderConfig; runtime?: ProviderRuntime } = {},
): Promise<ProviderHealth> {
  const config = options.config ?? resolveMlbProviderConfig();
  const runtime = options.runtime ?? defaultRuntime;
  if (!config.enabled || !config.endpoint) {
    return {
      configured: Boolean(config.endpoint),
      reachable: false,
      checkedAt: null,
      requiredCapabilityCount: REQUIRED_REMOTE_TOOLS.size,
      availableCapabilityCount: 0,
      circuitOpen: isCircuitOpen(config, runtime),
      lastErrorCode,
    };
  }
  try {
    const tools = await discoverTools(config, runtime);
    return {
      configured: true,
      reachable: true,
      checkedAt: new Date(cachedCatalog?.checkedAt ?? runtime.now()).toISOString(),
      requiredCapabilityCount: REQUIRED_REMOTE_TOOLS.size,
      availableCapabilityCount: [...REQUIRED_REMOTE_TOOLS].filter((name) => tools.has(name)).length,
      circuitOpen: isCircuitOpen(config, runtime),
      lastErrorCode,
    };
  } catch (error) {
    const normalized = normalizeError(error, config);
    lastErrorCode = normalized.code;
    return {
      configured: true,
      reachable: false,
      checkedAt: new Date(runtime.now()).toISOString(),
      requiredCapabilityCount: REQUIRED_REMOTE_TOOLS.size,
      availableCapabilityCount: 0,
      circuitOpen: isCircuitOpen(config, runtime),
      lastErrorCode,
    };
  }
}

export function resetMlbProviderStateForTests() {
  cachedCatalog = null;
  consecutiveTransientFailures = 0;
  circuitOpenedAt = 0;
  lastErrorCode = null;
}

export type { ProviderRuntime };
