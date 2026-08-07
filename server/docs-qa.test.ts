import { describe, expect, it } from "vitest";
import { answerDocsQuestion } from "./docs-qa";

describe("docs-qa", () => {
  it("answers CLI access questions from handbook extracts", async () => {
    const result = await answerDocsQuestion("how do i access the cli");
    expect(result.fallbackUsed).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.answer.toLowerCase()).toContain("api token");
  });

  it("describes the public MCP endpoint and bearer authentication", async () => {
    const result = await answerDocsQuestion("how do i access the sportfolio mcp protocol");
    expect(result.fallbackUsed).toBe(true);
    expect(result.answer).toContain("/mcp");
    expect(result.answer.toLowerCase()).toContain("bearer");
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it("returns a grounded extract for terminal automation questions", async () => {
    const result = await answerDocsQuestion("how do i access sportfolio from a terminal");
    expect(result.fallbackUsed).toBe(true);
    expect(result.answer.length).toBeGreaterThan(20);
    expect(result.citations.length).toBeGreaterThan(0);
  });
});
