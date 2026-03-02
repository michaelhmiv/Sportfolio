import { getModels, type Api, type Model } from "@mariozechner/pi-ai";
import { getManagedProviderRuntimeConfig, getManagedProviderStatus } from "./provider-registry";
import { getActiveManagedProviderSelection } from "./system-settings";

const DEFAULT_CUSTOM_CONTEXT_WINDOW = 200_000;
const DEFAULT_CUSTOM_MAX_TOKENS = 32_768;

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
    const parts = normalized.split(".").map((part) => Number(part));
    const [a, b] = parts;
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
  }

  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }

  return false;
}

export function normalizeOpenAICompatibleBaseUrl(rawBaseUrl: string): string {
  const parsedUrl = new URL(rawBaseUrl.trim());
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && parsedUrl.protocol !== "https:") {
    throw new Error("BYOK endpoints must use HTTPS in production");
  }

  if (isProduction && isLocalOrPrivateHost(parsedUrl.hostname)) {
    throw new Error(
      "BYOK endpoints may not target localhost or private network hosts in production",
    );
  }

  parsedUrl.search = "";
  parsedUrl.hash = "";
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");

  if (parsedUrl.pathname.endsWith("/chat/completions")) {
    parsedUrl.pathname = parsedUrl.pathname.slice(0, -"/chat/completions".length);
  }

  return parsedUrl.toString().replace(/\/+$/, "");
}

function buildCustomOpenAIModel(input: {
  modelId: string;
  providerId: string;
  baseUrl: string;
  headers?: Record<string, string>;
  compat?: Model<"openai-completions">["compat"];
}): Model<"openai-completions"> {
  return {
    id: input.modelId,
    name: input.modelId,
    api: "openai-completions",
    provider: input.providerId,
    baseUrl: input.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: DEFAULT_CUSTOM_CONTEXT_WINDOW,
    maxTokens: DEFAULT_CUSTOM_MAX_TOKENS,
    ...(input.headers ? { headers: input.headers } : {}),
    ...(input.compat ? { compat: input.compat } : {}),
  };
}

function buildCustomAnthropicModel(input: {
  modelId: string;
  providerId: string;
  baseUrl: string;
  headers?: Record<string, string>;
}): Model<"anthropic-messages"> {
  return {
    id: input.modelId,
    name: input.modelId,
    api: "anthropic-messages",
    provider: input.providerId,
    baseUrl: input.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: DEFAULT_CUSTOM_CONTEXT_WINDOW,
    maxTokens: DEFAULT_CUSTOM_MAX_TOKENS,
    ...(input.headers ? { headers: input.headers } : {}),
  };
}

function resolveManagedModel(providerKey: "chutes" | "minimax" | "openrouter", modelId: string) {
  const runtime = getManagedProviderRuntimeConfig(providerKey);

  if (providerKey === "minimax") {
    const builtinModel = getModels("minimax").find((model) => model.id === modelId);
    if (builtinModel && runtime.api === "anthropic-messages") {
      return {
        ...builtinModel,
        baseUrl: runtime.baseUrl,
        ...(runtime.headers
          ? {
              headers: {
                ...(builtinModel.headers || {}),
                ...runtime.headers,
              },
            }
          : {}),
      } satisfies Model<Api>;
    }
  }

  if (runtime.api === "anthropic-messages") {
    return buildCustomAnthropicModel({
      modelId,
      providerId: runtime.providerId,
      baseUrl: runtime.baseUrl,
      headers: runtime.headers,
    }) satisfies Model<Api>;
  }

  return buildCustomOpenAIModel({
    modelId,
    providerId: runtime.providerId,
    baseUrl: runtime.baseUrl,
    headers: runtime.headers,
    compat: runtime.compat,
  }) satisfies Model<Api>;
}

export interface PiRuntime {
  apiKey: string;
  model: Model<Api>;
  headers?: Record<string, string>;
  onPayload?: (payload: unknown) => void;
}

export async function resolveManagedPiRuntime(input: { model?: string } = {}): Promise<PiRuntime> {
  const selection = await getActiveManagedProviderSelection();
  const status = getManagedProviderStatus(selection.provider);
  const runtime = getManagedProviderRuntimeConfig(selection.provider);

  if (!status.configured || !runtime.apiKey) {
    throw new Error(`Managed ${status.label} provider is not configured`);
  }

  const modelId = input.model?.trim() || selection.modelOverride || status.defaultModel || null;

  if (!modelId) {
    throw new Error(
      `Managed ${status.label} provider is missing a default model. Set the provider's default model before enabling it.`,
    );
  }

  const headers =
    runtime.authMode === "raw"
      ? {
          ...(runtime.headers || {}),
          Authorization: runtime.apiKey,
        }
      : runtime.headers;
  const onPayload = runtime.payloadDefaults
    ? (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }

        const record = payload as Record<string, unknown>;
        for (const [key, value] of Object.entries(runtime.payloadDefaults || {})) {
          if (record[key] === undefined) {
            record[key] = value;
          }
        }
      }
    : undefined;

  return {
    apiKey: runtime.apiKey,
    model: resolveManagedModel(selection.provider, modelId),
    ...(headers ? { headers } : {}),
    ...(onPayload ? { onPayload } : {}),
  };
}

export function resolveOpenAICompatiblePiRuntime(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): PiRuntime {
  return {
    apiKey: input.apiKey,
    model: buildCustomOpenAIModel({
      modelId: input.model,
      providerId: "openai-compatible",
      baseUrl: normalizeOpenAICompatibleBaseUrl(input.baseUrl),
    }),
  };
}
