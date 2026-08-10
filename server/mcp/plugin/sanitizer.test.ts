import { describe, expect, it } from "vitest";
import { assertNoRestrictedPluginFields, sanitizePluginValue } from "./sanitizer";

describe("plugin sanitizer player identity", () => {
  it("preserves a public NASCAR driver name as displayName while removing direct-name fields", () => {
    const sanitized = sanitizePluginValue({
      id: "nascar_4023",
      sport: "NASCAR",
      team: "NCS",
      position: "DRV",
      firstName: "Ryan",
      lastName: "Blaney",
    });

    expect(sanitized).toEqual({
      displayName: "Ryan Blaney",
      id: "nascar_4023",
      sport: "NASCAR",
      team: "NCS",
      position: "DRV",
    });
    expect(() => assertNoRestrictedPluginFields(sanitized)).not.toThrow();
  });

  it("preserves player identity from canonical ids even when sport is absent", () => {
    const sanitized = sanitizePluginValue({
      id: "mlb_669711",
      firstName: "Lucas",
      lastName: "Giolito",
      team: "BOS",
    });

    expect(sanitized).toMatchObject({
      id: "mlb_669711",
      displayName: "Lucas Giolito",
      team: "BOS",
    });
  });

  it("does not convert private user PII into displayName", () => {
    const sanitized = sanitizePluginValue({
      id: "user_123",
      firstName: "Private",
      lastName: "Person",
      email: "private@example.com",
      username: "playerone",
    });

    expect(sanitized).toEqual({ id: "user_123", username: "playerone" });
  });

  it("enriches nested holdings with player display names", () => {
    const sanitized = sanitizePluginValue({
      items: [
        {
          holding: { assetId: "nascar_4213", quantity: "1" },
          player: {
            id: "nascar_4213",
            sport: "NASCAR",
            firstName: "Connor",
            lastName: "Zilisch",
            team: "NXS",
          },
        },
      ],
    }) as any;

    expect(sanitized.items[0].player.displayName).toBe("Connor Zilisch");
    expect(sanitized.items[0].player.firstName).toBeUndefined();
    expect(sanitized.items[0].player.lastName).toBeUndefined();
  });
});
