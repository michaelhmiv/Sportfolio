import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
  },
}));

describe("native-runtime", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses emulator localhost backend in dev when served from 10.0.2.2", async () => {
    vi.stubGlobal("window", {
      location: {
        host: "10.0.2.2:5000",
      },
    });

    const nativeRuntime = await import("./native-runtime");
    expect(nativeRuntime.getNativeApiOrigin()).toBe("http://10.0.2.2:5000");
    expect(nativeRuntime.resolveApiUrl("/api/dashboard")).toBe(
      "http://10.0.2.2:5000/api/dashboard",
    );
  });
});
