import { executePublicTool, type PublicMcpServerContext } from "../../public-tool-registry";
import { normalizePlayerDisplayNames } from "./player-display-name";

type JsonRecord = Record<string, unknown>;
export type ComposedToolState = "ok" | "empty" | "unavailable";
export type ComposedToolResult =
  | { state: "ok"; data: JsonRecord }
  | { state: "empty"; data: JsonRecord }
  | { state: "unavailable"; code: string; message: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const value = String((error as { code?: unknown }).code || "").trim();
    if (value) return value;
  }
  return "composed_tool_unavailable";
}

/**
 * Invoke a public tool through the same registry execution path used by MCP.
 * executePublicTool resolves the definition and strictly parses its input schema
 * before invoking the implementation, so composed renderers cannot drift from
 * their child tool contracts.
 */
export async function invokeComposedPublicTool(
  context: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ComposedToolResult> {
  try {
    const normalized = record(
      normalizePlayerDisplayNames(await executePublicTool(context, name, args)),
    );
    return Object.keys(normalized).length === 0
      ? { state: "empty", data: normalized }
      : { state: "ok", data: normalized };
  } catch (error) {
    return {
      state: "unavailable",
      code: errorCode(error),
      message: error instanceof Error ? error.message : `${name} is unavailable.`,
    };
  }
}

export function composedToolValue(result: ComposedToolResult): JsonRecord {
  if (result.state === "unavailable") {
    return {
      state: result.state,
      unavailable: true,
      code: result.code,
      message: result.message,
    };
  }
  return result.data;
}

export function composedToolWarning(result: ComposedToolResult): string | undefined {
  return result.state === "unavailable" ? result.message : undefined;
}
