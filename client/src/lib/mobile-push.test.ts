import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckPermissions = vi.fn();
const mockRequestPermissions = vi.fn();
const mockRegister = vi.fn();
const mockCreateChannel = vi.fn();

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

describe("mobile push helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheckPermissions.mockReset();
    mockRequestPermissions.mockReset();
    mockRegister.mockReset();
    mockCreateChannel.mockReset();
    const localStorage = new LocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);
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
  });

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
    expect(mockCreateChannel).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });
});
