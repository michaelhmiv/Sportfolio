import { describe, expect, it } from "vitest";
import { prepareAssistantMessageDisplay } from "./message-format";

describe("message-format", () => {
  it("strips redundant raw table text when a structured table block is present", () => {
    const result = prepareAssistantMessageDisplay({
      contentText:
        "Here are the top 5 MLB batters by OPS playing today (2026-03-27), pulled from the live stats feed: | # | Player | Team | Pos | OPS | OBP | Price | Game | |---|--------|------|-----|-----|-----|-------|------| | 1 | **Yordan Alvarez** | HOU | OF | 1.478 | .578 | $10 | vs LAA | Want me to pull up full player detail on any of them?",
      uiBlocks: [
        {
          type: "entity_table",
          slot: "chat_inline",
          priority: 30,
          props: {
            title: "MLB stat gameplan",
            helper: null,
            columns: [],
            rows: [],
          },
        },
      ],
    });

    expect(result.beforeText).toBe(
      "Here are the top 5 MLB batters by OPS playing today (2026-03-27), pulled from the live stats feed:",
    );
    expect(result.afterText).toBe("Want me to pull up full player detail on any of them?");
  });

  it("normalizes compact markdown tables when there is no structured table block", () => {
    const result = prepareAssistantMessageDisplay({
      contentText:
        "Top MLB OPS leaders: | # | Player | Team | OPS | |---|--------|------|-----| | 1 | Aaron Judge | NYY | 1.111 | | 2 | Yordan Alvarez | HOU | 1.022 |",
      uiBlocks: [],
    });

    expect(result.beforeText).toContain("Top MLB OPS leaders:");
    expect(result.beforeText).toContain("\n\n| # | Player | Team | OPS |");
    expect(result.beforeText).toContain("\n|---|--------|------|-----|");
    expect(result.beforeText).toContain("\n| 1 | Aaron Judge | NYY | 1.111 |");
    expect(result.afterText).toBeNull();
  });

  it("leaves plain assistant text unchanged", () => {
    const result = prepareAssistantMessageDisplay({
      contentText: "Aaron Judge looks strong tonight.",
      uiBlocks: [],
    });

    expect(result.beforeText).toBe("Aaron Judge looks strong tonight.");
    expect(result.afterText).toBeNull();
  });
});
