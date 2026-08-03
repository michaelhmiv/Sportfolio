import { describe, expect, it } from "vitest";
import {
  PLUGIN_MARKETPLACE_V1_CONTRACT,
  PLUGIN_V1_EXCLUDED_CAPABILITIES,
  PLUGIN_V1_TOOLS,
} from "./capability-policy";

describe("marketplace v1 capability contract", () => {
  it("uses a separate marketplace endpoint", () => {
    expect(PLUGIN_MARKETPLACE_V1_CONTRACT.endpoint).toBe("/mcp/plugin");
  });

  it("contains unique, read-only, non-destructive tools", () => {
    const names = PLUGIN_V1_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);

    for (const tool of PLUGIN_V1_TOOLS) {
      expect(tool.readOnly).toBe(true);
      expect(tool.destructive).toBe(false);
      expect(tool.openWorld).toBe(false);
    }
  });

  it("does not expose restricted capability families", () => {
    const allowedNames = PLUGIN_V1_TOOLS.map((tool) => tool.name);
    const forbiddenPatterns = [
      /^stage_/,
      /^admin_/,
      /^internal_/,
      /token/i,
      /byok/i,
      /sms/i,
      /premium/i,
      /checkout/i,
      /redeem/i,
      /confirm/i,
      /cancel/i,
      /update_/,
      /delete_/,
      /create_agent_thread/,
      /send_agent_message/,
    ];

    for (const name of allowedNames) {
      for (const pattern of forbiddenPatterns) {
        expect(name).not.toMatch(pattern);
      }
    }
  });

  it("documents all critical denied capability families", () => {
    const deniedNames = PLUGIN_V1_EXCLUDED_CAPABILITIES.map((entry) => entry.name);
    expect(deniedNames).toContain("save_agent_byok");
    expect(deniedNames).toContain("complete_sms_link");
    expect(deniedNames).toContain("list_api_tokens");
    expect(deniedNames).toContain("redeem_premium");
    expect(deniedNames).toContain("stage_*");
    expect(deniedNames).toContain("dynamic:internal_mlb_mcp");
  });
});
