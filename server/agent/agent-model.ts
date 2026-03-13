import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import { completeSimple, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import { decryptText } from "../lib/encryption";
import {
  normalizeOpenAICompatibleBaseUrl,
  resolveManagedPiRuntime,
  resolveOpenAICompatiblePiRuntime,
  type PiRuntime,
} from "./pi-provider";
import type { AgentProviderFailureClass } from "./types";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Unknown provider error";
}

export function classifyAgentProviderFailure(error: unknown): AgentProviderFailureClass {
  const message = getErrorMessage(error).toLowerCase();

  if (
    /\b(401|403|unauthorized|forbidden|invalid api key|api key|missing api key|credential|authentication|auth)\b/.test(
      message,
    )
  ) {
    return "auth";
  }

  if (
    /\b(413|payload too large|context length|context window|prompt is too long|too many tokens|maximum context|token limit|input too long)\b/.test(
      message,
    )
  ) {
    return "context_overflow";
  }

  if (
    /\b(429|500|502|503|504|timeout|timed out|aborted|rate limit|temporarily unavailable|connection reset|socket hang up|fetch failed|network)\b/.test(
      message,
    )
  ) {
    return "transient";
  }

  if (
    /\b(invalid json|malformed|parse|tool call|toolcall|finish_reason|unexpected response|invalid response)\b/.test(
      message,
    )
  ) {
    return "malformed_response";
  }

  return "unknown";
}

export function stripHiddenReasoningText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolveAgentPiRuntime(
  profile: UserAgentProfile,
  secret: UserAgentSecret | undefined,
): Promise<PiRuntime> {
  if (profile.providerMode === "byok") {
    if (!secret) {
      throw new Error("BYOK is selected but no API key is configured");
    }
    if (!profile.baseUrl) {
      throw new Error("BYOK is selected but no base URL is configured");
    }

    const apiKey = decryptText({
      ciphertext: secret.apiKeyCiphertext,
      iv: secret.apiKeyIv,
      authTag: secret.apiKeyAuthTag,
    });

    return resolveOpenAICompatiblePiRuntime({
      apiKey,
      baseUrl: normalizeOpenAICompatibleBaseUrl(profile.baseUrl),
      model: profile.model,
    });
  }

  return resolveManagedPiRuntime({
    model: profile.model,
  });
}

export async function callAgentModel(input: {
  profile: UserAgentProfile;
  secret?: UserAgentSecret;
  systemPrompt: string;
  messages: Message[];
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  temperature: number;
  maxTokens: number;
}): Promise<AssistantMessage> {
  const runtime = await resolveAgentPiRuntime(input.profile, input.secret);

  return completeSimple(
    runtime.model,
    {
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      ...(input.tools && input.tools.length > 0 ? { tools: input.tools as any } : {}),
    },
    {
      apiKey: runtime.apiKey,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      ...(runtime.headers ? { headers: runtime.headers } : {}),
      ...(runtime.onPayload ? { onPayload: runtime.onPayload } : {}),
    },
  );
}
