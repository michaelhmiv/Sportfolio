import { describe, expect, it } from "vitest";
import { getPublicToolDefinition } from "../public-tool-registry";
import { PLUGIN_V1_TOOLS } from "./capability-policy";
import { PLUGIN_TOOL_ADAPTERS } from "./adapters";
import { assertNoRestrictedPluginFields, sanitizePluginValue } from "./sanitizer";

describe("marketplace tool adapters", () => {
  it("implements every v1 policy tool exactly once", () => {
    const policyNames = PLUGIN_V1_TOOLS.map((tool) => tool.name).sort();
    const adapterNames = PLUGIN_TOOL_ADAPTERS.map((tool) => tool.name).sort();
    expect(adapterNames).toEqual(policyNames);
    expect(new Set(adapterNames).size).toBe(adapterNames.length);
  });

  it("maps every marketplace tool to an existing static public tool", () => {
    for (const adapter of PLUGIN_TOOL_ADAPTERS) {
      expect(getPublicToolDefinition(adapter.sourceTool), `${adapter.name} -> ${adapter.sourceTool}`).not.toBeNull();
      expect(adapter.sourceTool).not.toMatch(/^(?:stage_|confirm_|cancel_|save_|clear_|redeem_|create_|update_|delete_|revoke_)/);
    }
  });

  it("removes authentication secrets, direct PII, and diagnostic internals", () => {
    const sanitized = sanitizePluginValue({
      summary: "ok",
      email: "person@example.com",
      phone: "+15555555555",
      accessToken: "secret",
      nested: {
        service_role: "secret",
        stack: "trace",
        safe: "value",
      },
    });

    expect(sanitized).toEqual({ summary: "ok", nested: { safe: "value" } });
    expect(() => assertNoRestrictedPluginFields(sanitized)).not.toThrow();
  });

  it("bounds arrays, strings, and recursive depth", () => {
    const sanitized = sanitizePluginValue(
      { items: [1, 2, 3], text: "abcdefgh", nested: { deeper: { value: true } } },
      { maxArrayItems: 2, maxStringLength: 4, maxDepth: 2 },
    );
    expect(sanitized).toEqual({
      items: [1, 2],
      text: "abcd…",
      nested: { deeper: "[truncated]" },
    });
  });
});
