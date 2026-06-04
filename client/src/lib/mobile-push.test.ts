import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckPermissions = vi.fn();
const mockRequestPermissions = vi.fn();
const mockRegister = vi.fn();
const mockCreateChannel = vi.fn();
const mockGetDeliveredNotifications = vi.fn();
const mockGetInfo = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
    getPlatform: vi.fn(() => "android"),
  },
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: mockCheckPermissions,
    requestPermissions: mockRequestPermissions,
    register: mockRegister,
    createChannel: mockCreateChannel,
    getDeliveredNotifications: mockGetDeliveredNotifications,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: mockGetInfo,
  },
}));

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

let testLocalStorage: LocalStorageMock;

describe("mobile push helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheckPermissions.mockReset();
    mockRequestPermissions.mockReset();
    mockRegister.mockReset();
    mockCreateChannel.mockReset();
    mockGetDeliveredNotifications.mockReset();
    mockGetInfo.mockReset();
    testLocalStorage = new LocalStorageMock();
    vi.stubGlobal("window", { localStorage: testLocalStorage });
    vi.stubGlobal("localStorage", testLocalStorage);
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures prompt state without suppressing future explicit requests", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
    const { getAndroidPushPermissionSnapshot, registerForAndroidPushes } =
      await import("./mobile-push");

    const snapshot = await getAndroidPushPermissionSnapshot();
    expect(snapshot.state).toBe("prompt");
    expect(snapshot.canPrompt).toBe(true);
    expect(snapshot.lastKnownState).toBe(null);

    mockRequestPermissions.mockResolvedValue({ receive: "denied" });
    const denied = await registerForAndroidPushes({
      allowPrompt: true,
      promptSource: "explicit",
      logLabel: "test_explicit",
    });

    expect(denied).toEqual({
      state: "denied",
      prompted: true,
      registered: false,
    });
    expect(mockRegister).not.toHaveBeenCalled();
  }, 10000);

  it("returns the persisted permission state before refreshing the snapshot", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "granted" });
    testLocalStorage.setItem("android_push_permission_status_v2", "denied");
    const { getAndroidPushPermissionSnapshot } = await import("./mobile-push");

    const snapshot = await getAndroidPushPermissionSnapshot();

    expect(snapshot.state).toBe("granted");
    expect(snapshot.lastKnownState).toBe("denied");
  }, 10000);

  it("marks auto prompts separately and registers granted devices", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    mockCreateChannel.mockResolvedValue(undefined);
    mockRegister.mockResolvedValue(undefined);

    const { hasAutoPromptedForPushPermission, registerForAndroidPushes } =
      await import("./mobile-push");

    const result = await registerForAndroidPushes({
      allowPrompt: true,
      promptSource: "auto",
      logLabel: "test_auto",
    });

    expect(result).toEqual({
      state: "granted",
      prompted: true,
      registered: true,
    });
    expect(hasAutoPromptedForPushPermission()).toBe(true);
    expect(mockCreateChannel).toHaveBeenCalledTimes(4);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it("does not persist the auto-prompt marker when the permission request fails", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
    mockRequestPermissions.mockRejectedValue(new Error("request failed"));

    const { hasAutoPromptedForPushPermission, registerForAndroidPushes } =
      await import("./mobile-push");

    await expect(
      registerForAndroidPushes({
        allowPrompt: true,
        promptSource: "auto",
        logLabel: "test_auto_failure",
      }),
    ).rejects.toThrow("request failed");

    expect(hasAutoPromptedForPushPermission()).toBe(false);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("returns the native app version when available", async () => {
    mockGetInfo.mockResolvedValue({ version: "1.2.3" });
    const { getNativeAppVersion } = await import("./mobile-push");

    await expect(getNativeAppVersion()).resolves.toBe("1.2.3");
  });
});
