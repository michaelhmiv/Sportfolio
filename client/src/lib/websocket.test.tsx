import { describe, expect, it } from "vitest";
import { collectionMembershipNotice, rememberCollectionEvent } from "./websocket";

describe("rememberCollectionEvent", () => {
  it("accepts the first delivery and rejects duplicates", () => {
    const seen = new Set<string>();

    expect(rememberCollectionEvent(seen, "event-1")).toBe(true);
    expect(rememberCollectionEvent(seen, "event-1")).toBe(false);
  });

  it("bounds the deduplication window and evicts the oldest event", () => {
    const seen = new Set<string>();

    expect(rememberCollectionEvent(seen, "event-1", 2)).toBe(true);
    expect(rememberCollectionEvent(seen, "event-2", 2)).toBe(true);
    expect(rememberCollectionEvent(seen, "event-3", 2)).toBe(true);

    expect([...seen]).toEqual(["event-2", "event-3"]);
    expect(rememberCollectionEvent(seen, "event-1", 2)).toBe(true);
  });
});

describe("collectionMembershipNotice", () => {
  it("notifies for leaderboard refreshes and ignores ordinary collection events", () => {
    expect(
      collectionMembershipNotice({
        type: "collections",
        eventType: "membership_changed",
        reason: "tracking_refresh",
      }),
    ).toContain("automatically released");
    expect(
      collectionMembershipNotice({ type: "collections", eventType: "allocation_changed" }),
    ).toBeNull();
  });
});
