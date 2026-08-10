import { describe, expect, it } from "vitest";
import { PLAYER_NAME_UNAVAILABLE, resolvePlayerDisplayName } from "./player-display-name";

describe("player display-name normalization", () => {
  it("uses the required human-name priority", () => {
    expect(resolvePlayerDisplayName({ playerName: "Player Name", displayName: "Display" })).toBe(
      "Player Name",
    );
    expect(resolvePlayerDisplayName({ displayName: "Display", name: "Name" })).toBe("Display");
    expect(resolvePlayerDisplayName({ name: "Name", firstName: "First", lastName: "Last" })).toBe(
      "Name",
    );
    expect(resolvePlayerDisplayName({ firstName: "First", lastName: "Last" })).toBe("First Last");
  });

  it("never substitutes an identifier for a missing human name", () => {
    expect(resolvePlayerDisplayName({ id: "player_123", playerId: "player_123" })).toBe(
      PLAYER_NAME_UNAVAILABLE,
    );
    expect(PLAYER_NAME_UNAVAILABLE).toBe("Name unavailable");
  });
});
