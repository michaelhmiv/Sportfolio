import { randomUUID } from "node:crypto";
import { callNativeMlbTool, nativeMlbHealth } from "./native-provider";

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

type ProviderHealth = {
  configured: boolean;
  reachable: boolean;
  checkedAt: string | null;
  requiredCapabilityCount: number;
  availableCapabilityCount: number;
  circuitOpen: boolean;
  lastErrorCode: MlbProviderErrorCode | null;
};

export type ProviderRuntime = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_HEALTH_CACHE_MS = 60_000;
const DEFAULT_RESPONSE_LIMIT = 150_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_RESET_MS = 30_000;
const NATIVE_ENDPOINT = "native://mlb-statsapi";
const CAPABILITY_COUNT = CURATED_MLB_TOOL_NAMES.length;

const defaultRuntime: ProviderRuntime = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let consecutiveTransientFailures = 0;
let circuitOpenedAt = 0;
let lastErrorCode: MlbProviderErrorCode | null = null;

export function resolveMlbProviderConfig(): MlbProviderConfig {
  return {
    enabled: true,
    endpoint: NATIVE_ENDPOINT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    healthCacheMs: DEFAULT_HEALTH_CACHE_MS,
    authBearerToken: null,
    maxResponseChars: DEFAULT_RESPONSE_LIMIT,
    circuitFailureThreshold: DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
    circuitResetMs: DEFAULT_CIRCUIT_RESET_MS,
  };
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

function recordFailure(error: MlbProviderError, config: MlbProviderConfig, runtime: ProviderRuntime) {
  lastErrorCode = error.code;
  if (!error.retryable) return;
  consecutiveTransientFailures += 1;
  if (consecutiveTransientFailures >= config.circuitFailureThreshold) {
    circuitOpenedAt = runtime.now();
  }
}

function normalizeError(error: unknown): MlbProviderError {
  if (error instanceof MlbProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout|timed out/i.test(message)) {
    return new MlbProviderError("provider_timeout", "MLB data request timed out.", true);
  }
  if (/required|must be|unsupported|invalid/i.test(message)) {
    return new MlbProviderError("provider_invalid_request", message, false);
  }
  return new MlbProviderError("provider_upstream_error", `MLB data provider failed: ${message}`, true);
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

  if (!config.enabled) {
    throw new MlbProviderError("provider_disabled", "MLB data provider is disabled.", false);
  }
  if (!config.endpoint) {
    throw new MlbProviderError("provider_unavailable", "MLB data provider is not configured.", true);
  }
  if (isCircuitOpen(config, runtime)) {
    throw new MlbProviderError(
      "provider_unavailable",
      "MLB data provider circuit is temporarily open.",
      true,
      { circuitOpen: true },
    );
  }

  let lastError: MlbProviderError | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const payload = assertResponseSize(
        await callNativeMlbTool(publicTool, args, { timeoutMs: config.timeoutMs }),
        config,
      );
      recordSuccess();
      console.info("[mlb-native] invocation", {
        requestId,
        publicTool,
        status: "success",
        durationMs: runtime.now() - startedAt,
        outputBytes: Buffer.byteLength(JSON.stringify(payload)),
        attempt,
      });
      return {
        summary: `Loaded MLB data for ${publicTool}.`,
        data: payload,
        warnings: [],
        provider: { name: "mlb-statsapi-native", capability: publicTool, requestId },
      };
    } catch (error) {
      const normalized = normalizeError(error);
      lastError = normalized;
      recordFailure(normalized, config, runtime);
      if (!normalized.retryable || attempt === 2 || isCircuitOpen(config, runtime)) break;
      await runtime.sleep(25);
    }
  }

  const error =
    lastError ?? new MlbProviderError("provider_unavailable", "MLB data provider is unavailable.", true);
  console.warn("[mlb-native] invocation", {
    requestId,
    publicTool,
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
      configured: false,
      reachable: false,
      checkedAt: null,
      requiredCapabilityCount: CAPABILITY_COUNT,
      availableCapabilityCount: 0,
      circuitOpen: isCircuitOpen(config, runtime),
      lastErrorCode,
    };
  }

  try {
    const health = await nativeMlbHealth();
    if (health.reachable) recordSuccess();
    return {
      configured: true,
      reachable: health.reachable,
      checkedAt: health.checkedAt,
      requiredCapabilityCount: CAPABILITY_COUNT,
      availableCapabilityCount: health.reachable ? CAPABILITY_COUNT : 0,
      circuitOpen: isCircuitOpen(config, runtime),
      lastErrorCode,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    lastErrorCode = normalized.code;
    return {
      configured: true,
      reachable: false,
      checkedAt: new Date(runtime.now()).toISOString(),
      requiredCapabilityCount: CAPABILITY_COUNT,
      availableCapabilityCount: 0,
      circuitOpen: isCircuitOpen(config, runtime),
      lastErrorCode,
    };
  }
}

export function resetMlbProviderStateForTests() {
  consecutiveTransientFailures = 0;
  circuitOpenedAt = 0;
  lastErrorCode = null;
}
