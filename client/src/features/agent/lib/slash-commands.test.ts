import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, matchSlashCommands } from "./slash-commands";

describe("slash-commands", () => {
  it("returns all commands for a bare slash trigger", () => {
    expect(matchSlashCommands("/")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("matches commands by prefix case-insensitively", () => {
    expect(matchSlashCommands("/TE")).toEqual([
      expect.objectContaining({
        command: "/team",
      }),
    ]);
  });

  it("returns no matches when the input is not a slash command", () => {
    expect(matchSlashCommands("review my setup")).toEqual([]);
  });
});
