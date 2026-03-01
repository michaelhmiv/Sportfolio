import { describe, expect, it } from "vitest";
import type { UserAgentProfile } from "@shared/schema";
import { buildHostedWebResearchQueries, shouldUseHostedWebResearch } from "./research";

function buildProfile(overrides: Partial<UserAgentProfile> = {}): UserAgentProfile {
  return {
    id: "profile_1",
    userId: "user_1",
    enabled: true,
    displayName: "Test Agent",
    providerMode: "managed",
    providerType: "openai_compatible",
    model: "managed-default",
    baseUrl: null,
    systemPrompt: "test",
    userPromptTemplate: "test",
    temperature: "0.20",
    maxTokens: 1200,
    analysisWindowMinutes: 1440,
    defaultSport: "NBA",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("agent hosted research", () => {
  it("detects explicit web-research requests", () => {
    expect(shouldUseHostedWebResearch("search the web for latest Nikola Jokic injury news")).toBe(
      true,
    );
    expect(shouldUseHostedWebResearch("give me the latest news on Anthony Edwards")).toBe(true);
    expect(shouldUseHostedWebResearch("buy $25 of Nikola Jokic")).toBe(false);
  });

  it("builds a small, de-duplicated Brave query set", () => {
    const queries = buildHostedWebResearchQueries(
      "Can you search the web for latest Nikola Jokic injury news for me?",
      buildProfile(),
    );

    expect(queries[0]).toBe("Nikola Jokic injury");
    expect(queries).toContain("Nikola Jokic injury NBA news");
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.length).toBeLessThanOrEqual(3);
  });
});
