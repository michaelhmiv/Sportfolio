import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildRedditPostPreview: vi.fn(),
  buildRedditPreviewImageSvg: vi.fn(),
  reportRedditPost: vi.fn(),
  verifyRedditPreviewImageSignature: vi.fn(),
}));

vi.mock("../reddit-bot-auth", () => ({
  requireRedditBotToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../reddit-market-posts", () => ({
  REDDIT_POST_TYPES: ["morning_recap", "pregame_preview"],
  buildRedditPostPreview: mocks.buildRedditPostPreview,
  buildRedditPreviewImageSvg: mocks.buildRedditPreviewImageSvg,
  reportRedditPost: mocks.reportRedditPost,
  verifyRedditPreviewImageSignature: mocks.verifyRedditPreviewImageSignature,
}));

import { registerRedditBotRoutes } from "./reddit-bot";

describe("reddit bot routes", () => {
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    mocks.buildRedditPostPreview.mockReset();
    mocks.buildRedditPreviewImageSvg.mockReset();
    mocks.reportRedditPost.mockReset();

    mocks.buildRedditPostPreview.mockResolvedValue({
      subreddit: "sportfoliomarket",
      postType: "morning_recap",
      sports: ["NBA"],
      marketDay: "2026-03-08",
      shouldPost: true,
      title: "Sportfolio Morning Recap | Mar 8 | NBA",
      markdown: "# recap",
      contentHash: "a".repeat(64),
      summary: {
        label: "Morning Recap",
        bullets: ["Top riser: Someone +$1.23"],
        newsCount: 1,
        gameCount: 0,
      },
      history: null,
    });
    mocks.buildRedditPreviewImageSvg.mockReturnValue("<svg></svg>");
    mocks.verifyRedditPreviewImageSignature.mockReturnValue(true);
    mocks.reportRedditPost.mockResolvedValue({
      id: "history-1",
      subreddit: "sportfoliomarket",
      postType: "morning_recap",
      marketDay: "2026-03-08",
      status: "posted",
    });

    const app = express();
    app.use(express.json());
    registerRedditBotRoutes(app);

    server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });

    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
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

  it("returns a reddit preview payload", async () => {
    const response = await fetch(`${baseUrl}/api/integrations/reddit/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subreddit: "sportfoliomarket",
        postType: "morning_recap",
        sports: ["NBA"],
        reserve: true,
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.title).toContain("Morning Recap");
    expect(mocks.buildRedditPostPreview).toHaveBeenCalledWith({
      subreddit: "sportfoliomarket",
      postType: "morning_recap",
      sports: ["NBA"],
      reserve: true,
    });
  });

  it("returns SVG output for the preview image endpoint", async () => {
    const response = await fetch(`${baseUrl}/api/integrations/reddit/preview-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subreddit: "sportfoliomarket",
        postType: "morning_recap",
      }),
    });
    const payload = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(payload).toBe("<svg></svg>");
    expect(mocks.buildRedditPreviewImageSvg).toHaveBeenCalled();
  });

  it("returns SVG output for the signed public preview image endpoint", async () => {
    const response = await fetch(
      `${baseUrl}/api/integrations/reddit/preview-image.svg?subreddit=sportfoliomarket&postType=morning_recap&marketDay=2026-03-08&sports=NBA,NFL&sig=${"b".repeat(64)}`,
    );
    const payload = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(payload).toBe("<svg></svg>");
    expect(mocks.verifyRedditPreviewImageSignature).toHaveBeenCalledWith(
      {
        subreddit: "sportfoliomarket",
        postType: "morning_recap",
        sports: ["NBA", "NFL"],
        marketDay: "2026-03-08",
        titleTemplate: null,
      },
      "b".repeat(64),
    );
  });

  it("rejects malformed report payloads", async () => {
    const response = await fetch(`${baseUrl}/api/integrations/reddit/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subreddit: "sportfoliomarket",
        postType: "morning_recap",
        marketDay: "bad-date",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toMatch(/invalid reddit integration payload/i);
  });

  it("records reddit post reports", async () => {
    const response = await fetch(`${baseUrl}/api/integrations/reddit/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subreddit: "sportfoliomarket",
        postType: "morning_recap",
        marketDay: "2026-03-08",
        contentHash: "a".repeat(64),
        status: "posted",
        title: "Sportfolio Morning Recap | Mar 8 | NBA",
        markdown: "# recap",
        redditPostId: "t3_abc123",
        redditPostUrl: "https://reddit.com/r/sportfoliomarket/comments/abc123",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.history.status).toBe("posted");
    expect(mocks.reportRedditPost).toHaveBeenCalledWith({
      subreddit: "sportfoliomarket",
      postType: "morning_recap",
      marketDay: "2026-03-08",
      contentHash: "a".repeat(64),
      status: "posted",
      title: "Sportfolio Morning Recap | Mar 8 | NBA",
      markdown: "# recap",
      redditPostId: "t3_abc123",
      redditPostUrl: "https://reddit.com/r/sportfoliomarket/comments/abc123",
    });
  });
});
