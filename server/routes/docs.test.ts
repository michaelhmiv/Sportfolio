import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  answerDocsQuestion: vi.fn(),
}));

vi.mock("../supabaseAuth", () => ({
  optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../docs-qa", () => ({
  answerDocsQuestion: mocks.answerDocsQuestion,
}));

import { registerDocsRoutes, resetDocsAskRateLimiterForTests } from "./docs";

describe("docs routes", () => {
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    resetDocsAskRateLimiterForTests();
    mocks.answerDocsQuestion.mockReset();
    mocks.answerDocsQuestion.mockImplementation(async (query: string) => ({
      query,
      answer: `Answer for ${query}`,
      citations: [],
      fallbackUsed: false,
    }));

    const app = express();
    app.use(express.json());
    registerDocsRoutes(app);

    server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });

    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    resetDocsAskRateLimiterForTests();
    mocks.answerDocsQuestion.mockReset();

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      server = null;
    }
  });

  it("returns the handbook payload with the access chapter first", async () => {
    const response = await fetch(`${baseUrl}/api/docs/handbook`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.handbook.title).toBe("Sportfolio Handbook");
    expect(payload.handbook.sections[0]?.id).toBe("getting-started");
    expect(payload.handbook.sections[0]?.chapters[0]?.slug).toBe("access");
  });

  it("returns docs search results with handbook anchor ids", async () => {
    const response = await fetch(`${baseUrl}/api/docs/search?q=mcp%20cli%20access`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0]?.anchorId).toMatch(/^chapter-/);
  });

  it("answers docs questions through the public ask route", async () => {
    const response = await fetch(`${baseUrl}/api/docs/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "how do i access the cli",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer).toBe("Answer for how do i access the cli");
    expect(mocks.answerDocsQuestion).toHaveBeenCalledWith("how do i access the cli");
  });

  it("rate limits docs ask requests after five calls per IP window", async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${baseUrl}/api/docs/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `question ${index}`,
        }),
      });

      expect(response.status).toBe(200);
    }

    const limitedResponse = await fetch(`${baseUrl}/api/docs/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "question 6",
      }),
    });
    const payload = await limitedResponse.json();

    expect(limitedResponse.status).toBe(429);
    expect(payload.message).toMatch(/rate limit/i);
  });
});
