import { describe, expect, it } from "vitest";

import {
  buildIssueTitle,
  inferDiscordReportType,
  sliceMessagesAfterCursor,
} from "./discord-report-sync";

import type { DiscordMessageObject } from "./discord-api";

function buildMessage(id: string, timestamp: string): DiscordMessageObject {
  return {
    id,
    channel_id: "thread_1",
    type: 0,
    content: `message-${id}`,
    timestamp,
    author: {
      id: "user_1",
      username: "tester",
      global_name: "Tester",
      bot: false,
    },
    attachments: [],
  };
}

describe("discord-report-sync", () => {
  it("infers bug and feature report types from forum parent channels", () => {
    expect(
      inferDiscordReportType({
        parentChannelId: "bug_forum",
        bugForumChannelId: "bug_forum",
        featureForumChannelId: "feature_forum",
      }),
    ).toBe("bug");

    expect(
      inferDiscordReportType({
        parentChannelId: "feature_forum",
        bugForumChannelId: "bug_forum",
        featureForumChannelId: "feature_forum",
      }),
    ).toBe("feature");

    expect(
      inferDiscordReportType({
        parentChannelId: "other",
        bugForumChannelId: "bug_forum",
        featureForumChannelId: "feature_forum",
      }),
    ).toBeNull();
  });

  it("returns only new messages after the saved cursor", () => {
    const messages = [
      buildMessage("m1", "2026-05-01T10:00:00.000Z"),
      buildMessage("m2", "2026-05-01T10:05:00.000Z"),
      buildMessage("m3", "2026-05-01T10:10:00.000Z"),
    ];

    expect(sliceMessagesAfterCursor(messages, null).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(sliceMessagesAfterCursor(messages, "m2").map((m) => m.id)).toEqual(["m3"]);
    expect(sliceMessagesAfterCursor(messages, "missing").map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("builds issue titles with type prefixes", () => {
    expect(buildIssueTitle("bug", "Trades fail on confirm")).toBe("[Bug] Trades fail on confirm");
    expect(buildIssueTitle("feature", "Add better market filters")).toBe(
      "[Feature] Add better market filters",
    );
  });
});
