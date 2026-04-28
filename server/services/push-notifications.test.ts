import { describe, expect, it, vi } from "vitest";
import { PushNotificationService } from "./push-notifications";

describe("PushNotificationService", () => {
  it("skips delivery when notification preference is disabled", async () => {
    const storageMock = {
      listActiveUserPushTokens: vi.fn().mockResolvedValue([]),
      markUserPushTokenDeliverySuccess: vi.fn(),
      markUserPushTokenDeliveryFailure: vi.fn(),
      getUserNotificationPreferences: vi.fn().mockResolvedValue([
        {
          notificationType: "watchlist_news",
          enabled: false,
        },
      ]),
      createPushNotificationEvent: vi.fn().mockResolvedValue({ id: "event_1" }),
      updatePushNotificationEvent: vi.fn().mockResolvedValue(undefined),
    };

    const providerFactory = vi.fn();
    const service = new PushNotificationService({
      storageLayer: storageMock as any,
      providerFactory,
    });

    const result = await service.send({
      userId: "user-1",
      type: "watchlist_news",
      title: "News",
      body: "Body",
      route: "/news",
      dedupeKey: "news-1",
    });

    expect(result.status).toBe("skipped_preferences");
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("returns duplicate when dedupe key already exists", async () => {
    const storageMock = {
      listActiveUserPushTokens: vi.fn().mockResolvedValue([]),
      markUserPushTokenDeliverySuccess: vi.fn(),
      markUserPushTokenDeliveryFailure: vi.fn(),
      getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      createPushNotificationEvent: vi.fn().mockResolvedValue(undefined),
      updatePushNotificationEvent: vi.fn().mockResolvedValue(undefined),
    };

    const service = new PushNotificationService({
      storageLayer: storageMock as any,
      providerFactory: vi.fn(),
    });

    const result = await service.send({
      userId: "user-1",
      type: "scout_complete",
      title: "Scouts",
      body: "Done",
      route: "/portfolio",
      dedupeKey: "scout-hourly-1",
    });

    expect(result.status).toBe("duplicate");
    expect(storageMock.listActiveUserPushTokens).not.toHaveBeenCalled();
  });

  it("marks invalid tokens inactive when provider rejects them", async () => {
    const storageMock = {
      listActiveUserPushTokens: vi.fn().mockResolvedValue([
        { id: "tok_1", token: "token-1" },
        { id: "tok_2", token: "token-2" },
      ]),
      markUserPushTokenDeliverySuccess: vi.fn().mockResolvedValue(undefined),
      markUserPushTokenDeliveryFailure: vi.fn().mockResolvedValue(undefined),
      getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      createPushNotificationEvent: vi.fn().mockResolvedValue({ id: "event_2" }),
      updatePushNotificationEvent: vi.fn().mockResolvedValue(undefined),
    };

    const providerFactory = vi.fn().mockResolvedValue({
      sendMulticast: vi.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        results: [
          { success: true, messageId: "msg_1" },
          {
            success: false,
            errorCode: "messaging/registration-token-not-registered",
            errorMessage: "not registered",
          },
        ],
      }),
    });

    const service = new PushNotificationService({
      storageLayer: storageMock as any,
      providerFactory,
    });

    const result = await service.send({
      userId: "user-1",
      type: "boost_settled",
      title: "Boost settled",
      body: "Done",
      route: "/boosts",
      dedupeKey: "boost-1",
    });

    expect(result.status).toBe("partial");
    expect(storageMock.markUserPushTokenDeliverySuccess).toHaveBeenCalledWith("tok_1");
    expect(storageMock.markUserPushTokenDeliveryFailure).toHaveBeenCalledWith(
      "tok_2",
      expect.stringContaining("messaging/registration-token-not-registered"),
      { deactivate: true },
    );
    expect(providerFactory).toHaveBeenCalled();
    expect(storageMock.updatePushNotificationEvent).toHaveBeenCalledWith(
      "event_2",
      expect.objectContaining({
        deliveryStatus: "partial",
        metadata: expect.objectContaining({
          delivery: expect.objectContaining({
            channelId: "sportfolio_gameplay",
            collapseKey: "boost-1",
          }),
        }),
      }),
    );
    const sendMulticast = await providerFactory.mock.results[0]?.value.then(
      (provider: { sendMulticast: unknown }) => provider.sendMulticast,
    );
    expect(sendMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event_2",
        }),
      }),
    );
  });
});
