import { type Model } from "@mariozechner/pi-ai";
import {
  DEFAULT_MANAGED_MODEL,
  type ManagedProviderKey,
  type ManagedProviderStatus,
} from "./types";

const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
const SUPPORTED_MINIMAX_AGENT_MODELS = [
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2.1-highspeed",
  "MiniMax-M2",
] as const;
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/v1";

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

function buildMinimaxProvider(): ManagedProviderConfig {
  const apiKey = readEnv("MINIMAX_API_KEY", "MINIMAX_CODING_PLAN_API_KEY");
  const defaultModel = DEFAULT_MINIMAX_MODEL;
  const models = dedupeModels(
    [defaultModel],
    normalizeModels(readEnv("MINIMAX_MODELS")),
    getBuiltinMinimaxModels(),
  );

  return {
    key: "minimax",
    label: "MiniMax",
    configured: Boolean(apiKey),
    supportsHermesToolLoop: true,
    apiKey,
    api: "openai-completions",
    providerId: "minimax",
    authMode: "standard",
    baseUrl: normalizeBaseUrl(readEnv("MINIMAX_BASE_URL") || DEFAULT_MINIMAX_BASE_URL),
    defaultModel: defaultModel || models[0] || DEFAULT_MANAGED_MODEL,
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

function getManagedProviderConfig(_key: ManagedProviderKey): ManagedProviderConfig {
  return buildMinimaxProvider();
}

function toManagedProviderStatus(provider: ManagedProviderConfig): ManagedProviderStatus {
  return {
    key: provider.key,
    label: provider.label,
    configured: provider.configured,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    models: provider.models,
    supportsHermesToolLoop: provider.supportsHermesToolLoop,
  };
}

export function isManagedProviderKey(value: string): value is ManagedProviderKey {
  return value === "minimax";
}

export function getDefaultManagedProviderKey(): ManagedProviderKey {
  return "minimax";
}

export function getManagedProviderStatus(key: ManagedProviderKey): ManagedProviderStatus {
  return toManagedProviderStatus(getManagedProviderConfig(key));
}

export function getManagedProviderStatuses(): ManagedProviderStatus[] {
  return [getManagedProviderStatus("minimax")];
}

export function getManagedProviderRuntimeConfig(key: ManagedProviderKey): ManagedProviderConfig {
  return getManagedProviderConfig(key);
}
