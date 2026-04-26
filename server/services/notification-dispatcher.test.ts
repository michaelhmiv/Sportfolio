import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCategoryEligibleUsers: vi.fn(),
  getAllUsersEligibleForCategory: vi.fn(),
  getActivePushDevicesForUsers: vi.fn(),
  markPushTokenInvalid: vi.fn(),
  sendPushMulticast: vi.fn(),
}));

vi.mock("./notification-settings", () => ({
  getCategoryEligibleUsers: mocks.getCategoryEligibleUsers,
  getAllUsersEligibleForCategory: mocks.getAllUsersEligibleForCategory,
  getActivePushDevicesForUsers: mocks.getActivePushDevicesForUsers,
  markPushTokenInvalid: mocks.markPushTokenInvalid,
}));

vi.mock("./push-notifications", () => ({
  sendPushMulticast: mocks.sendPushMulticast,
}));

import {
  clearNotificationCooldownCacheForTests,
  sendCategoryBroadcastNotification,
  sendUserNotification,
} from "./notification-dispatcher";

describe("notification dispatcher", () => {
  beforeEach(() => {
    clearNotificationCooldownCacheForTests();
    vi.clearAllMocks();
    mocks.getCategoryEligibleUsers.mockResolvedValue(["user-1"]);
    mocks.getAllUsersEligibleForCategory.mockResolvedValue(["user-1"]);
    mocks.getActivePushDevicesForUsers.mockResolvedValue([{ userId: "user-1", token: "token-1" }]);
    mocks.sendPushMulticast.mockResolvedValue({
      providerEnabled: true,
      attempted: 1,
      sentCount: 1,
      failureCount: 0,
      invalidTokens: [],
    });
  });

  it("sends to eligible user tokens", async () => {
    const result = await sendUserNotification({
      userId: "user-1",
      category: "trade_execution",
      title: "Filled",
      body: "Your order filled",
      dedupeKey: "trade:1",
    });

    expect(mocks.getCategoryEligibleUsers).toHaveBeenCalledWith(["user-1"], "trade_execution");
    expect(mocks.getActivePushDevicesForUsers).toHaveBeenCalledWith(["user-1"]);
    expect(mocks.sendPushMulticast).toHaveBeenCalledTimes(1);
    expect(result.sentCount).toBe(1);
    expect(result.recipientUsers).toBe(1);
  });

  it("does not send when category filtering excludes users", async () => {
    mocks.getCategoryEligibleUsers.mockResolvedValue([]);

    const result = await sendUserNotification({
      userId: "user-1",
      category: "market_alerts",
      title: "Market Pulse",
      body: "No-op",
      dedupeKey: "market:1",
    });

    expect(mocks.sendPushMulticast).not.toHaveBeenCalled();
    expect(result.attemptedTokens).toBe(0);
    expect(result.recipientUsers).toBe(0);
  });

  it("dedupes repeat sends inside cooldown windows", async () => {
    const first = await sendUserNotification({
      userId: "user-1",
      category: "trade_execution",
      title: "Filled",
      body: "Your order filled",
      dedupeKey: "trade:dedupe",
      cooldownMs: 60_000,
    });

    const second = await sendUserNotification({
      userId: "user-1",
      category: "trade_execution",
      title: "Filled",
      body: "Your order filled",
      dedupeKey: "trade:dedupe",
      cooldownMs: 60_000,
    });

    expect(first.attemptedTokens).toBe(1);
    expect(second.attemptedTokens).toBe(0);
    expect(mocks.sendPushMulticast).toHaveBeenCalledTimes(1);
  });

  it("invalidates tokens returned by the push provider", async () => {
    mocks.sendPushMulticast.mockResolvedValue({
      providerEnabled: true,
      attempted: 1,
      sentCount: 0,
      failureCount: 1,
      invalidTokens: ["token-1"],
    });

    await sendCategoryBroadcastNotification({
      category: "system_operational",
      title: "System Notice",
      body: "Maintenance",
      dedupeKey: "broadcast:1",
    });

    expect(mocks.markPushTokenInvalid).toHaveBeenCalledWith("token-1", "fcm_invalid_token");
  });
});
