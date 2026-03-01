import { type Model } from "@mariozechner/pi-ai";
import {
  DEFAULT_MANAGED_MODEL,
  type ManagedProviderKey,
  type ManagedProviderStatus,
} from "./types";

const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.5";
const SUPPORTED_MINIMAX_AGENT_MODELS = [DEFAULT_MINIMAX_MODEL];
const DEFAULT_CHUTES_BASE_URL = "https://llm.chutes.ai/v1";
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type ManagedProviderConfig = ManagedProviderStatus & {
  apiKey: string | null;
  api: "openai-completions" | "anthropic-messages";
  providerId: string;
  authMode: "standard" | "raw";
  headers?: Record<string, string>;
  compat?: Model<"openai-completions">["compat"];
  payloadDefaults?: Record<string, unknown>;
};

function readEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeDefaultModel(value: string | null): string | null {
  return value?.trim() || null;
}

function normalizeModels(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupeModels(...groups: Array<Array<string | null | undefined>>): string[] {
  const seen = new Set<string>();
  const models: string[] = [];

  for (const group of groups) {
    for (const model of group) {
      const normalized = model?.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      models.push(normalized);
    }
  }

  return models;
}

function getBuiltinMinimaxModels(): string[] {
  return [...SUPPORTED_MINIMAX_AGENT_MODELS];
}

function buildChutesProvider(): ManagedProviderConfig {
  const apiKey = readEnv("CHUTES_API_KEY", "USER_AGENT_MANAGED_API_KEY");
  const defaultModel = normalizeDefaultModel(
    readEnv("CHUTES_DEFAULT_MODEL", "USER_AGENT_MANAGED_DEFAULT_MODEL") || DEFAULT_MANAGED_MODEL,
  );
  const models = dedupeModels(
    [defaultModel],
    normalizeModels(readEnv("CHUTES_MODELS", "USER_AGENT_MANAGED_MODELS")),
  );

  return {
    key: "chutes",
    label: "Chutes",
    configured: Boolean(apiKey),
    apiKey,
    api: "openai-completions",
    providerId: "chutes",
    authMode: "raw",
    baseUrl: normalizeBaseUrl(
      readEnv("CHUTES_BASE_URL", "USER_AGENT_MANAGED_BASE_URL") || DEFAULT_CHUTES_BASE_URL,
    ),
    defaultModel: models[0] || defaultModel,
    models,
  };
}

function buildMinimaxProvider(): ManagedProviderConfig {
  const apiKey = readEnv("MINIMAX_API_KEY", "MINIMAX_CODING_PLAN_API_KEY");
  const defaultModel = normalizeDefaultModel(
    readEnv("MINIMAX_DEFAULT_MODEL") || DEFAULT_MINIMAX_MODEL,
  );
  const models = dedupeModels(
    [defaultModel],
    normalizeModels(readEnv("MINIMAX_MODELS")),
    getBuiltinMinimaxModels(),
  );

  return {
    key: "minimax",
    label: "MiniMax",
    configured: Boolean(apiKey),
    apiKey,
    api: "openai-completions",
    providerId: "minimax",
    authMode: "standard",
    baseUrl: normalizeBaseUrl(readEnv("MINIMAX_BASE_URL") || DEFAULT_MINIMAX_BASE_URL),
    defaultModel: models[0] || defaultModel,
    models,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
    },
    payloadDefaults: {
      reasoning_split: true,
    },
  };
}

function buildOpenRouterHeaders(): Record<string, string> | undefined {
  const siteUrl = readEnv("OPENROUTER_SITE_URL");
  const appName = readEnv("OPENROUTER_APP_NAME", "OPENROUTER_TITLE");
  const headers: Record<string, string> = {};

  if (siteUrl) {
    headers["HTTP-Referer"] = siteUrl;
  }

  if (appName) {
    headers["X-Title"] = appName;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function buildOpenRouterProvider(): ManagedProviderConfig {
  const apiKey = readEnv("OPENROUTER_API_KEY");
  const defaultModel = normalizeDefaultModel(readEnv("OPENROUTER_DEFAULT_MODEL"));
  const models = dedupeModels([defaultModel], normalizeModels(readEnv("OPENROUTER_MODELS")));

  return {
    key: "openrouter",
    label: "OpenRouter",
    configured: Boolean(apiKey),
    apiKey,
    api: "openai-completions",
    providerId: "openrouter",
    authMode: "standard",
    baseUrl: normalizeBaseUrl(readEnv("OPENROUTER_BASE_URL") || DEFAULT_OPENROUTER_BASE_URL),
    defaultModel: models[0] || defaultModel,
    models,
    headers: buildOpenRouterHeaders(),
  };
}

function getManagedProviderConfig(key: ManagedProviderKey): ManagedProviderConfig {
  switch (key) {
    case "chutes":
      return buildChutesProvider();
    case "minimax":
      return buildMinimaxProvider();
    case "openrouter":
      return buildOpenRouterProvider();
  }
}

function toManagedProviderStatus(provider: ManagedProviderConfig): ManagedProviderStatus {
  return {
    key: provider.key,
    label: provider.label,
    configured: provider.configured,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    models: provider.models,
  };
}

export function isManagedProviderKey(value: string): value is ManagedProviderKey {
  return value === "chutes" || value === "minimax" || value === "openrouter";
}

export function getDefaultManagedProviderKey(): ManagedProviderKey {
  const configured = readEnv("USER_AGENT_MANAGED_PROVIDER");
  return configured && isManagedProviderKey(configured) ? configured : "chutes";
}

export function getManagedProviderStatus(key: ManagedProviderKey): ManagedProviderStatus {
  return toManagedProviderStatus(getManagedProviderConfig(key));
}

export function getManagedProviderStatuses(): ManagedProviderStatus[] {
  return [
    getManagedProviderStatus("chutes"),
    getManagedProviderStatus("minimax"),
    getManagedProviderStatus("openrouter"),
  ];
}

export function getManagedProviderRuntimeConfig(key: ManagedProviderKey): ManagedProviderConfig {
  return getManagedProviderConfig(key);
}
