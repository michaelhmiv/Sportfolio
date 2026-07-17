import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  setBroadcastFn,
  broadcastIdentityChanged,
  invalidateIdentity,
  type IdentityChangedEvent,
} from "./identity-events";

describe("identity-events", () => {
  beforeEach(() => {
    // Reset the broadcast fn between tests
    setBroadcastFn(null as any);
  });

  it("broadcastIdentityChanged sends { type: 'identity', data: { userId, timestamp } }", () => {
    const messages: Array<{ type: string; data: unknown }> = [];
    setBroadcastFn((msg) => messages.push(msg));

    broadcastIdentityChanged("user-1");

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("identity");
    const data = messages[0].data as IdentityChangedEvent;
    expect(data.userId).toBe("user-1");
    expect(typeof data.timestamp).toBe("string");
    expect(() => new Date(data.timestamp)).not.toThrow();
  });

  it("broadcastIdentityChanged is a no-op when broadcast fn is not set", () => {
    expect(() => broadcastIdentityChanged("user-1")).not.toThrow();
  });

  it("invalidateIdentity calls broadcastIdentityChanged", () => {
    const messages: Array<{ type: string; data: unknown }> = [];
    setBroadcastFn((msg) => messages.push(msg));

    invalidateIdentity("user-1");

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("identity");
  });

  it("exposes only userId and timestamp — no badge/progress internals", () => {
    const messages: Array<{ type: string; data: unknown }> = [];
    setBroadcastFn((msg) => messages.push(msg));

    broadcastIdentityChanged("user-1");

    const data = messages[0].data as Record<string, unknown>;
    const keys = Object.keys(data);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("userId");
    expect(keys).toContain("timestamp");
    // Must NOT contain any of these
    expect(data).not.toHaveProperty("badge");
    expect(data).not.toHaveProperty("activeBadge");
    expect(data).not.toHaveProperty("premiumActive");
    expect(data).not.toHaveProperty("username");
    expect(data).not.toHaveProperty("avatarUrl");
    expect(data).not.toHaveProperty("assemblyState");
    expect(data).not.toHaveProperty("progressBps");
  });
});
