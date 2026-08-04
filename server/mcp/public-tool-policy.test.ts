import { describe, expect, it } from "vitest";
import {
  buildPublicPromptRegistry,
  buildPublicToolRegistry,
  resolveDynamicMlbPublicTools,
} from "./public-tool-registry";
import { getDeniedPublicToolNames, isApprovedPublicToolName } from "./public-tool-policy";

describe("public tool policy", () => {
  it("excludes every retired legacy capability", () => {
    const names = new Set(buildPublicToolRegistry().map((tool) => tool.name));
    for (const denied of getDeniedPublicToolNames()) {
      expect(names.has(denied), denied).toBe(false);
    }
  });

  it("rejects raw provider pass-through names", () => {
    expect(isApprovedPublicToolName("mlb_mcp__get_schedule")).toBe(false);
    expect(buildPublicToolRegistry().some((tool) => tool.name.startsWith("mlb_mcp__"))).toBe(false);
  });

  it("keeps staged action finalizers public", () => {
    const names = new Set(buildPublicToolRegistry().map((tool) => tool.name));
    expect(names.has("get_pending_action")).toBe(true);
    expect(names.has("confirm_pending_action")).toBe(true);
    expect(names.has("cancel_pending_action")).toBe(true);
  });

  it("removes retired advisory prompts", () => {
    const names = buildPublicPromptRegistry().map((prompt) => prompt.name);
    expect(names).not.toContain("review_setup");
    expect(names).not.toContain("review_idle_cash");
    expect(names).toContain("find_boost_candidates");
    expect(names).toContain("stage_trade");
  });

  it("keeps the MLB provider internal without calling discovery", async () => {
    let called = false;
    const resolved = await resolveDynamicMlbPublicTools({
      getInternalMlbMcpToolCatalog: async () => {
        called = true;
        return [];
      },
    });

    expect(called).toBe(false);
    expect(resolved.tools).toEqual([]);
    expect(resolved.sourceStatus.available).toBe(true);
    expect(resolved.sourceStatus.toolCount).toBe(0);
    expect(resolved.sourceStatus.name).toContain("internal only");
  });
});
