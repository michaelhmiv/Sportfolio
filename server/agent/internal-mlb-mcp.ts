import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentToolDefinition } from "./types";

export const INTERNAL_MLB_MCP_SOURCE_ID = "internal_mlb_mcp";
const DEFAULT_TOOL_PREFIX = "mlb_mcp__";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_FAILURE_CACHE_TTL_MS = 15_000;
const DEFAULT_LOCAL_DEV_ENDPOINT = "http://127.0.0.1:8081/mcp";
const DEFAULT_LOCAL_DEV_TIMEOUT_MS = 10_000;
const LOCAL_DEV_PROBE_CACHE_TTL_MS = 30_000;
const LOCAL_DEV_PROBE_TIMEOUT_MS = 1_200;
const MAX_TOOL_RESULT_PAYLOAD_CHARS = 8_000;
const MAX_TOOL_RESULT_REPLY_TEXT_CHARS = 2_000;
const WARNING_THROTTLE_MS = 60_000;

type InternalMlbMcpConfig = {
  enabled: boolean;
  endpoint: string | null;
  toolPrefix: string;
  timeoutMs: number;
  cacheTtlMs: number;
  authBearerToken: string | null;
  implicitLocalDevFallback: boolean;
};

type MlbMcpToolDiscovery = {
  toolCatalog: AgentToolDefinition[];
  localToRemoteToolMap: Map<string, string>;
  expiresAt: number;
  failureBackoffActive: boolean;
};

type UnknownRecord = Record<string, unknown>;

let cachedDiscovery: MlbMcpToolDiscovery | null = null;
let inFlightDiscovery: Promise<MlbMcpToolDiscovery> | null = null;
let lastWarningAt = 0;
let cachedLocalDevProbe: {
  endpoint: string;
  reachable: boolean;
  expiresAt: number;
} | null = null;
let inFlightLocalDevProbe: Promise<boolean> | null = null;

function parseBooleanEnv(value: string | undefined): boolean | null {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeEndpoint(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidate = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/mcp";
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveInternalMlbMcpConfig(): InternalMlbMcpConfig {
  const explicitEnabled = parseBooleanEnv(process.env.HERMES_INTERNAL_MLB_MCP_ENABLED);
  const configuredEndpoint =
    process.env.HERMES_INTERNAL_MLB_MCP_URL?.trim() ||
    process.env.MLB_MCP_INTERNAL_URL?.trim() ||
    "";
  const isDevelopment =
    (process.env.NODE_ENV || "development").trim().toLowerCase() !== "production";
  const implicitLocalDevFallback =
    !configuredEndpoint && explicitEnabled !== false && isDevelopment;
  const endpoint = normalizeEndpoint(
    configuredEndpoint || (implicitLocalDevFallback ? DEFAULT_LOCAL_DEV_ENDPOINT : ""),
  );
  const enabled = explicitEnabled ?? Boolean(endpoint);

  return {
    enabled,
    endpoint,
    toolPrefix: process.env.HERMES_INTERNAL_MLB_MCP_TOOL_PREFIX?.trim() || DEFAULT_TOOL_PREFIX,
    timeoutMs: parseBoundedInt(
      process.env.HERMES_INTERNAL_MLB_MCP_TIMEOUT_MS,
      implicitLocalDevFallback ? DEFAULT_LOCAL_DEV_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
      2000,
      120_000,
    ),
    cacheTtlMs: parseBoundedInt(
      process.env.HERMES_INTERNAL_MLB_MCP_TOOL_CACHE_MS,
      DEFAULT_CACHE_TTL_MS,
      5000,
      600_000,
    ),
    authBearerToken: process.env.HERMES_INTERNAL_MLB_MCP_AUTH_BEARER?.trim() || null,
    implicitLocalDevFallback: implicitLocalDevFallback && Boolean(endpoint),
  };
}

function cloneInputSchema(
  inputSchema: AgentToolDefinition["inputSchema"] | null | undefined,
): AgentToolDefinition["inputSchema"] {
  if (!inputSchema || typeof inputSchema !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(inputSchema)) as AgentToolDefinition["inputSchema"];
}

function cloneToolEntry(entry: AgentToolDefinition): AgentToolDefinition {
  return {
    ...entry,
    whenToUse: [...entry.whenToUse],
    whenNotToUse: [...entry.whenNotToUse],
    examplePrompts: [...entry.examplePrompts],
    preferredColumns: [...(entry.preferredColumns || [])],
    autoContextArgs: [...(entry.autoContextArgs || [])],
    inputSchema: cloneInputSchema(entry.inputSchema),
  };
}

function cloneDiscovery(discovery: MlbMcpToolDiscovery): MlbMcpToolDiscovery {
  return {
    toolCatalog: discovery.toolCatalog.map(cloneToolEntry),
    localToRemoteToolMap: new Map(discovery.localToRemoteToolMap),
    expiresAt: discovery.expiresAt,
    failureBackoffActive: discovery.failureBackoffActive,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeRemoteToolName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool"
  );
}

function allocateLocalToolName(params: {
  remoteToolName: string;
  toolPrefix: string;
  usedToolNames: Set<string>;
}): string {
  const baseName = `${params.toolPrefix}${sanitizeRemoteToolName(params.remoteToolName)}`;
  if (!params.usedToolNames.has(baseName)) {
    params.usedToolNames.add(baseName);
    return baseName;
  }

  let suffix = 2;
  while (params.usedToolNames.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }
  const candidate = `${baseName}_${suffix}`;
  params.usedToolNames.add(candidate);
  return candidate;
}

function inferToolPresentationProfile(remoteToolName: string) {
  const normalized = remoteToolName.toLowerCase();
  if (normalized.includes("schedule")) {
    return "schedule" as const;
  }
  if (
    normalized.includes("leader") ||
    normalized.includes("expected_stats") ||
    normalized.includes("percentile") ||
    normalized.includes("arsenal")
  ) {
    return "leaderboard" as const;
  }
  return "generic" as const;
}

function inferToolPrimaryEntityType(remoteToolName: string) {
  const normalized = remoteToolName.toLowerCase();
  if (
    normalized.includes("batter") ||
    normalized.includes("pitcher") ||
    normalized.includes("player") ||
    normalized.includes("leader")
  ) {
    return "player" as const;
  }
  if (
    normalized.includes("schedule") ||
    normalized.includes("game") ||
    normalized.includes("boxscore")
  ) {
    return "game" as const;
  }
  return null;
}

function inferPreferredColumns(remoteToolName: string) {
  const normalized = remoteToolName.toLowerCase();
  if (normalized.includes("schedule")) {
    return ["matchup", "status", "startTime", "venue"];
  }
  if (normalized.includes("leader")) {
    return ["rank", "player", "team", "value"];
  }
  if (normalized.includes("expected_stats")) {
    return ["player", "metric", "value"];
  }
  return [];
}

type InternalMlbToolGuidance = {
  description?: string;
  whenToUse?: string[];
  whenNotToUse?: string[];
  examplePrompts?: string[];
};

const INTERNAL_MLB_TOOL_GUIDANCE: Record<string, InternalMlbToolGuidance> = {
  get_schedule: {
    description:
      "Internal MLB MCP: confirm the current matchup, game status, probable pitchers, and game timing for a specific date or team before ranking players.",
    whenToUse: [
      "Hermes needs to verify tonight's matchup, current game state, or probable pitchers before giving MLB advice.",
    ],
    whenNotToUse: [
      "The question is only about Sportfolio account state and does not need baseball enrichment.",
    ],
    examplePrompts: [
      "what is the Yankees matchup tonight?",
      "who are the probable starters for Yankees vs Marlins?",
    ],
  },
  get_team_roster: {
    description:
      "Internal MLB MCP: list a team's active roster. Use it to verify team membership; it is not the same as tonight's confirmed starting lineup.",
    whenToUse: [
      "Hermes needs to confirm whether a player is currently on a team before naming them in a gameplan.",
    ],
    whenNotToUse: [
      "You need only the expected starters or current batting order. Confirm the game context first.",
    ],
    examplePrompts: [
      "who is on the Yankees active roster right now?",
      "confirm whether this hitter is still on the Marlins roster",
    ],
  },
  get_team_batting: {
    description:
      "Internal MLB MCP: season-level team batting totals. Use it for whole-team offense context, not for ranking individual hitters.",
    whenToUse: [
      "Hermes wants a high-level view of how strong a team's offense has been this season.",
    ],
    whenNotToUse: [
      "You are comparing individual hitters, OBP, OPS, or lineup spots. Use roster, leaders, lineup, or player-stat tools instead.",
    ],
    examplePrompts: ["how good has the Yankees offense been this season overall?"],
  },
  get_team_leaders: {
    description:
      "Internal MLB MCP: return one team's leaders for a single stat category. Use explicit categories like onBasePercentage for OBP-style questions.",
    whenToUse: [
      "Hermes needs team-specific leader context after the matchup and roster are already confirmed.",
    ],
    whenNotToUse: [
      "You need today's lineup, current roster membership, or a leaguewide leaderboard.",
    ],
    examplePrompts: [
      "who leads the Yankees in onBasePercentage this season?",
      "who are the Marlins OPS leaders this year?",
    ],
  },
  get_league_leader_data: {
    description:
      "Internal MLB MCP: leaguewide leaderboard data for a stat category. Use it for MLB-wide context, not as proof of a team's current lineup or roster.",
    whenToUse: [
      "Hermes needs MLB-wide leader context, such as the best ERA marks or league OBP leaders.",
    ],
    whenNotToUse: [
      "You are building a single-game team-specific hitter plan or verifying team membership.",
    ],
    examplePrompts: ["who are the MLB ERA leaders right now?", "who leads MLB in OBP this season?"],
  },
  lookup_player: {
    description:
      "Internal MLB MCP: resolve MLB player metadata and identifiers. These are not Sportfolio player IDs.",
    whenToUse: ["Hermes needs MLB player metadata before another MLB-only enrichment read."],
    whenNotToUse: [
      "You are calling a Sportfolio-native tool that expects a Sportfolio player ID. Use a message-based preview tool instead.",
    ],
    examplePrompts: ["look up Aaron Judge in MLB data"],
  },
  get_playerid_lookup: {
    description:
      "Internal MLB MCP: resolve MLB and reference identifiers for a player name. These IDs are for MLB enrichment only, not for Sportfolio-native tool arguments.",
    whenToUse: ["Hermes needs an MLB lookup result before calling another MLB enrichment tool."],
    whenNotToUse: [
      "You want to pass the result into a Sportfolio-native tool. Use a preview tool with a natural-language message instead.",
    ],
    examplePrompts: ["find the MLB identifier for Max Fried"],
  },
};

function buildMcpToolDefinition(input: {
  localToolName: string;
  remoteToolName: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
}): AgentToolDefinition {
  const guidance = INTERNAL_MLB_TOOL_GUIDANCE[input.remoteToolName] || null;
  return {
    toolName: input.localToolName,
    category: "read",
    description: guidance?.description || input.description,
    whenToUse: guidance?.whenToUse || [
      `Use ${input.localToolName} when Hermes needs in-house MLB context from ${input.remoteToolName}.`,
    ],
    whenNotToUse: [
      "A Sportfolio-native Hermes tool already covers the exact account-specific question.",
      ...(guidance?.whenNotToUse || []),
    ],
    examplePrompts: guidance?.examplePrompts || [
      "buy 10 shares of the mlb player who had the most home runs last year",
      "who led mlb in home runs last season?",
    ],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: input.inputSchema,
    presentationProfile: inferToolPresentationProfile(input.remoteToolName),
    primaryEntityType: inferToolPrimaryEntityType(input.remoteToolName),
    preferredColumns: inferPreferredColumns(input.remoteToolName),
    exposure: "advanced",
    supportsSequentialUse: true,
    auditPriority: "high",
  };
}

function extractToolText(content: unknown[]): string | null {
  const parts: string[] = [];
  for (const chunk of content) {
    if (isRecord(chunk) && chunk.type === "text" && typeof chunk.text === "string") {
      const trimmed = chunk.text.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
    }
  }
  const merged = parts.join("\n\n").trim();
  return merged || null;
}

function buildMissingRemoteToolError(toolName: string) {
  return new Error(`Internal MLB MCP tool mapping was not found for ${toolName}.`);
}

function buildEmptyDiscovery(expiresAt: number): MlbMcpToolDiscovery {
  return {
    toolCatalog: [],
    localToRemoteToolMap: new Map<string, string>(),
    expiresAt,
    failureBackoffActive: false,
  };
}

function resolveFailureCacheTtlMs(config: InternalMlbMcpConfig) {
  return Math.min(config.cacheTtlMs, DEFAULT_FAILURE_CACHE_TTL_MS);
}

function extendDiscoveryRetryWindow(
  discovery: MlbMcpToolDiscovery,
  config: InternalMlbMcpConfig,
): MlbMcpToolDiscovery {
  return {
    toolCatalog: discovery.toolCatalog,
    localToRemoteToolMap: new Map(discovery.localToRemoteToolMap),
    expiresAt: Date.now() + resolveFailureCacheTtlMs(config),
    failureBackoffActive: true,
  };
}

function safeSerialize(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") {
      return serialized;
    }
  } catch {
    // Fall back to a bounded placeholder for unserializable payloads.
  }

  if (typeof value === "string") {
    return value;
  }

  return "[unserializable payload]";
}

function buildTruncatedPreview(input: { value: string; maxLength: number }): string {
  if (input.value.length <= input.maxLength) {
    return input.value;
  }

  const prefix = `Response truncated (${input.value.length} chars). `;
  const available = Math.max(0, input.maxLength - prefix.length - 3);
  return `${prefix}${input.value.slice(0, available)}...`;
}

function boundReplyText(replyText: string): {
  value: string;
  truncated: boolean;
  originalCharLength: number;
} {
  if (replyText.length <= MAX_TOOL_RESULT_REPLY_TEXT_CHARS) {
    return {
      value: replyText,
      truncated: false,
      originalCharLength: replyText.length,
    };
  }

  return {
    value: buildTruncatedPreview({
      value: replyText,
      maxLength: MAX_TOOL_RESULT_REPLY_TEXT_CHARS,
    }),
    truncated: true,
    originalCharLength: replyText.length,
  };
}

function boundToolContent(content: unknown[]): {
  value: unknown[];
  truncated: boolean;
  originalCharLength: number;
} {
  const serialized = safeSerialize(content);
  if (serialized.length <= MAX_TOOL_RESULT_PAYLOAD_CHARS) {
    return {
      value: content,
      truncated: false,
      originalCharLength: serialized.length,
    };
  }

  return {
    value: [
      {
        type: "text",
        text: buildTruncatedPreview({
          value: serialized,
          maxLength: MAX_TOOL_RESULT_PAYLOAD_CHARS,
        }),
      },
    ],
    truncated: true,
    originalCharLength: serialized.length,
  };
}

function boundStructuredContent(structuredContent: unknown): {
  value: unknown;
  truncated: boolean;
  originalCharLength: number;
} {
  const serialized = safeSerialize(structuredContent);
  if (serialized.length <= MAX_TOOL_RESULT_PAYLOAD_CHARS) {
    return {
      value: structuredContent,
      truncated: false,
      originalCharLength: serialized.length,
    };
  }

  return {
    value: {
      truncated: true,
      originalCharLength: serialized.length,
      preview: buildTruncatedPreview({
        value: serialized,
        maxLength: MAX_TOOL_RESULT_PAYLOAD_CHARS,
      }),
    },
    truncated: true,
    originalCharLength: serialized.length,
  };
}

async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return await new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout();
      reject(new Error(`Internal MLB MCP request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(resolve).catch(reject);
  }).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function buildLocalDevUnavailableError(endpoint: string) {
  return new Error(
    `Local vendored MLB MCP was not detected at ${endpoint}. Start the vendored server or set HERMES_INTERNAL_MLB_MCP_URL explicitly.`,
  );
}

async function ensureImplicitLocalDevEndpointReachable(config: InternalMlbMcpConfig) {
  if (!config.implicitLocalDevFallback || !config.endpoint) {
    return;
  }

  const now = Date.now();
  if (
    cachedLocalDevProbe &&
    cachedLocalDevProbe.endpoint === config.endpoint &&
    cachedLocalDevProbe.expiresAt > now
  ) {
    if (cachedLocalDevProbe.reachable) {
      return;
    }
    throw buildLocalDevUnavailableError(config.endpoint);
  }

  if (!inFlightLocalDevProbe) {
    inFlightLocalDevProbe = (async () => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), LOCAL_DEV_PROBE_TIMEOUT_MS);
      try {
        await fetch(config.endpoint!, {
          method: "GET",
          signal: abortController.signal,
          headers: {
            accept: "application/json, text/plain, */*",
          },
        });
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    })().finally(() => {
      inFlightLocalDevProbe = null;
    });
  }

  const reachable = await inFlightLocalDevProbe;
  cachedLocalDevProbe = {
    endpoint: config.endpoint,
    reachable,
    expiresAt: now + LOCAL_DEV_PROBE_CACHE_TTL_MS,
  };

  if (!reachable) {
    throw buildLocalDevUnavailableError(config.endpoint);
  }
}

async function withMlbMcpClient<T>(
  config: InternalMlbMcpConfig,
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  if (!config.endpoint) {
    throw new Error("Internal MLB MCP endpoint is not configured.");
  }

  await ensureImplicitLocalDevEndpointReachable(config);

  const abortController = new AbortController();
  const requestHeaders: Record<string, string> = {};
  if (config.authBearerToken) {
    requestHeaders.authorization = `Bearer ${config.authBearerToken}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
    requestInit: {
      headers: requestHeaders,
      signal: abortController.signal,
    },
  });
  const client = new Client({
    name: "sportfolio-hermes-internal-mlb-mcp",
    version: "1.0.0",
  });

  await promiseWithTimeout(client.connect(transport), config.timeoutMs, () =>
    abortController.abort(),
  );

  try {
    return await promiseWithTimeout(callback(client), config.timeoutMs, () =>
      abortController.abort(),
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function fetchToolDiscovery(config: InternalMlbMcpConfig): Promise<MlbMcpToolDiscovery> {
  const listResponse = (await withMlbMcpClient(config, (client) => client.listTools())) as {
    tools?: unknown[];
  };
  const tools = Array.isArray(listResponse?.tools) ? listResponse.tools : [];
  const usedToolNames = new Set<string>();
  const toolCatalog: AgentToolDefinition[] = [];
  const localToRemoteToolMap = new Map<string, string>();

  for (const tool of tools) {
    if (!isRecord(tool)) continue;
    const remoteToolName = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!remoteToolName) continue;

    const localToolName = allocateLocalToolName({
      remoteToolName,
      toolPrefix: config.toolPrefix,
      usedToolNames,
    });
    const description =
      typeof tool.description === "string" && tool.description.trim()
        ? `Internal MLB MCP: ${tool.description.trim()}`
        : `Internal MLB MCP capability ${remoteToolName}.`;

    const inputSchema = isRecord(tool.inputSchema)
      ? (JSON.parse(JSON.stringify(tool.inputSchema)) as Record<string, unknown>)
      : null;

    toolCatalog.push(
      buildMcpToolDefinition({
        localToolName,
        remoteToolName,
        description,
        inputSchema,
      }),
    );
    localToRemoteToolMap.set(localToolName, remoteToolName);
  }

  return {
    toolCatalog,
    localToRemoteToolMap,
    expiresAt: Date.now() + config.cacheTtlMs,
    failureBackoffActive: false,
  };
}

function warnOncePerWindow(message: string, error: unknown) {
  const now = Date.now();
  if (now - lastWarningAt < WARNING_THROTTLE_MS) return;
  lastWarningAt = now;
  const details = error instanceof Error ? error.message : String(error || "unknown error");
  console.warn(`[hermes/internal-mlb-mcp] ${message}: ${details}`);
}

async function loadToolDiscovery(forceRefresh = false): Promise<MlbMcpToolDiscovery> {
  const config = resolveInternalMlbMcpConfig();
  if (!config.enabled || !config.endpoint) {
    return buildEmptyDiscovery(Date.now() + config.cacheTtlMs);
  }

  const now = Date.now();
  if (!forceRefresh && cachedDiscovery && cachedDiscovery.expiresAt > now) {
    return cloneDiscovery(cachedDiscovery);
  }

  if (!forceRefresh && inFlightDiscovery) {
    return cloneDiscovery(await inFlightDiscovery);
  }

  inFlightDiscovery = fetchToolDiscovery(config)
    .then((discovery) => {
      cachedDiscovery = discovery;
      return discovery;
    })
    .finally(() => {
      inFlightDiscovery = null;
    });

  try {
    return cloneDiscovery(await inFlightDiscovery);
  } catch (error) {
    warnOncePerWindow("Failed to refresh internal MLB MCP tool catalog", error);
    cachedDiscovery = extendDiscoveryRetryWindow(
      cachedDiscovery || buildEmptyDiscovery(now + config.cacheTtlMs),
      config,
    );
    return cloneDiscovery(cachedDiscovery);
  }
}

async function resolveRemoteToolName(localToolName: string): Promise<string> {
  const current = await loadToolDiscovery(false);
  const direct = current.localToRemoteToolMap.get(localToolName);
  if (direct) return direct;

  if (current.failureBackoffActive && current.expiresAt > Date.now()) {
    throw new Error("Internal MLB MCP tool catalog is temporarily unavailable.");
  }

  const refreshed = await loadToolDiscovery(true);
  const afterRefresh = refreshed.localToRemoteToolMap.get(localToolName);
  if (afterRefresh) return afterRefresh;

  if (refreshed.failureBackoffActive && refreshed.expiresAt > Date.now()) {
    throw new Error("Internal MLB MCP tool catalog is temporarily unavailable.");
  }

  throw buildMissingRemoteToolError(localToolName);
}

async function callInternalMlbMcpToolUnbounded(input: {
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<{
  remoteToolName: string;
  content: unknown[];
  structuredContent: unknown;
  replyText: string | null;
}> {
  const config = resolveInternalMlbMcpConfig();
  if (!config.enabled || !config.endpoint) {
    throw new Error("Internal MLB MCP is not configured.");
  }

  const remoteToolName = await resolveRemoteToolName(input.toolName);
  const callResult = (await withMlbMcpClient(config, (client) =>
    client.callTool({
      name: remoteToolName,
      arguments: isRecord(input.args) ? input.args : {},
    }),
  )) as {
    isError?: boolean;
    content?: unknown[];
    structuredContent?: unknown;
  };

  const content = Array.isArray(callResult.content) ? callResult.content : [];
  const replyText = extractToolText(content);
  const isError = callResult.isError === true;

  if (isError) {
    throw new Error(replyText || `Internal MLB MCP tool ${remoteToolName} failed.`);
  }

  return {
    remoteToolName,
    content,
    structuredContent: callResult.structuredContent ?? null,
    replyText,
  };
}

export function isInternalMlbMcpProjectedTool(toolName: string): boolean {
  const config = resolveInternalMlbMcpConfig();
  if (!config.enabled) return false;
  const normalized = toolName.trim().toLowerCase();
  const prefix = config.toolPrefix.trim().toLowerCase();
  if (!prefix) return false;
  return normalized.startsWith(prefix);
}

export async function getInternalMlbMcpToolCatalog(): Promise<AgentToolDefinition[]> {
  try {
    const discovery = await loadToolDiscovery(false);
    return discovery.toolCatalog.map(cloneToolEntry);
  } catch (error) {
    warnOncePerWindow("Unable to load internal MLB MCP tools", error);
    return [];
  }
}

export async function getInternalMlbMcpStatus(): Promise<{
  enabled: boolean;
  endpointConfigured: boolean;
  available: boolean;
  toolCount: number;
  toolPrefix: string;
}> {
  const config = resolveInternalMlbMcpConfig();
  if (!config.enabled || !config.endpoint) {
    return {
      enabled: config.enabled,
      endpointConfigured: Boolean(config.endpoint),
      available: false,
      toolCount: 0,
      toolPrefix: config.toolPrefix,
    };
  }

  const toolCatalog = await getInternalMlbMcpToolCatalog();
  return {
    enabled: config.enabled,
    endpointConfigured: true,
    available: toolCatalog.length > 0,
    toolCount: toolCatalog.length,
    toolPrefix: config.toolPrefix,
  };
}

export async function runInternalMlbMcpToolRaw(input: {
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<{
  remoteToolName: string;
  content: unknown[];
  structuredContent: unknown;
  replyText: string | null;
}> {
  return callInternalMlbMcpToolUnbounded(input);
}

export async function runInternalMlbMcpToolBounded(input: {
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<{
  remoteToolName: string;
  content: unknown[];
  structuredContent: unknown;
  replyText: string | null;
  payloadTruncated: boolean;
  truncation: {
    replyTextChars: number | null;
    structuredContentChars: number | null;
    contentChars: number | null;
  } | null;
}> {
  const rawResult = await callInternalMlbMcpToolUnbounded(input);
  const content = boundToolContent(rawResult.content);
  const extractedReplyText = extractToolText(content.value);
  const structuredContent = boundStructuredContent(rawResult.structuredContent ?? null);
  const replyText = boundReplyText(
    extractedReplyText ||
      `Internal MLB MCP tool ${rawResult.remoteToolName} completed with structured output.`,
  );

  const payloadTruncated = replyText.truncated || structuredContent.truncated || content.truncated;

  return {
    remoteToolName: rawResult.remoteToolName,
    content: content.value,
    structuredContent: structuredContent.value,
    replyText: replyText.value,
    payloadTruncated,
    truncation: payloadTruncated
      ? {
          replyTextChars: replyText.truncated ? replyText.originalCharLength : null,
          structuredContentChars: structuredContent.truncated
            ? structuredContent.originalCharLength
            : null,
          contentChars: content.truncated ? content.originalCharLength : null,
        }
      : null,
  };
}

export async function runInternalMlbMcpReadTool(input: {
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  const boundedResult = await runInternalMlbMcpToolBounded(input);

  return {
    summary: `Loaded MLB data via ${boundedResult.remoteToolName}.`,
    replyText: boundedResult.replyText,
    context: {
      provider: "internal_mlb_mcp",
      remoteToolName: boundedResult.remoteToolName,
      structuredContent: boundedResult.structuredContent,
      content: boundedResult.content,
      payloadTruncated: boundedResult.payloadTruncated,
      truncation: boundedResult.truncation,
    },
  };
}

export function resetInternalMlbMcpCacheForTests() {
  cachedDiscovery = null;
  inFlightDiscovery = null;
  lastWarningAt = 0;
  cachedLocalDevProbe = null;
  inFlightLocalDevProbe = null;
}
