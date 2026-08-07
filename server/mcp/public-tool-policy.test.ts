import { describe, expect, it } from "vitest";
import { buildPublicPromptRegistry, buildPublicToolRegistry } from "./public-tool-registry";
import { getDeniedPublicToolNames, isApprovedPublicToolName } from "./public-tool-policy";

describe("public tool policy", () => {
  it("excludes every retired legacy capability", () => {
    const names = new Set(buildPublicToolRegistry().map((tool) => tool.name));
    for (const denied of getDeniedPublicToolNames()) {
      expect(names.has(denied), denied).toBe(false);
    }
  });

  it("publishes the curated semantic MLB tools", () => {
    const names = new Set(buildPublicToolRegistry().map((tool) => tool.name));
    expect(names.has("get_mlb_batting_leaders")).toBe(true);
    expect(names.has("get_mlb_pitching_leaders")).toBe(true);
    expect(names.has("get_mlb_games")).toBe(true);
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
});
