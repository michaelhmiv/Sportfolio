import { describe, expect, it } from "vitest";
import { buildPlayerIdentityContexts } from "./player-identity";

describe("player identity graph", () => {
  it("closes alias chains transitively in both directions", () => {
    const contexts = buildPlayerIdentityContexts(
      ["mlb_A", "mlb_C"],
      [
        { aliasPlayerId: "mlb_A", canonicalPlayerId: "mlb_B" },
        { aliasPlayerId: "mlb_B", canonicalPlayerId: "mlb_C" },
      ],
    );

    expect(contexts.get("mlb_A")).toEqual({
      requestedId: "mlb_A",
      canonicalId: "mlb_C",
      aliasIds: ["mlb_A", "mlb_B"],
      allIds: ["mlb_A", "mlb_B", "mlb_C"],
    });
    expect(contexts.get("mlb_C")?.allIds).toEqual(["mlb_A", "mlb_B", "mlb_C"]);
  });

  it("keeps unrelated identities isolated and deterministic", () => {
    const contexts = buildPlayerIdentityContexts(
      ["mlb_A", "mlb_X"],
      [
        { aliasPlayerId: "mlb_A", canonicalPlayerId: "mlb_B" },
        { aliasPlayerId: "mlb_X", canonicalPlayerId: "mlb_Y" },
      ],
    );

    expect(contexts.get("mlb_A")?.allIds).toEqual(["mlb_A", "mlb_B"]);
    expect(contexts.get("mlb_X")?.allIds).toEqual(["mlb_X", "mlb_Y"]);
  });
});
