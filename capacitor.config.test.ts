import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CAP_SERVER_URL = process.env.CAP_SERVER_URL;

async function loadConfig() {
  vi.resetModules();
  return (await import("./capacitor.config")).default;
}

afterEach(() => {
  if (typeof ORIGINAL_CAP_SERVER_URL === "string") {
    process.env.CAP_SERVER_URL = ORIGINAL_CAP_SERVER_URL;
  } else {
    delete process.env.CAP_SERVER_URL;
  }
  vi.resetModules();
});

describe("capacitor.config", () => {
  it("defaults native builds to the bundled production shell", async () => {
    delete process.env.CAP_SERVER_URL;

    const config = await loadConfig();

    expect(config.server).toBeUndefined();
    expect(config.plugins?.StatusBar).toMatchObject({
      style: "DEFAULT",
      overlaysWebView: true,
    });
    expect(config.plugins?.Keyboard).toMatchObject({
      resize: "body",
      resizeOnFullScreen: true,
      style: "DEFAULT",
    });
    expect(config.plugins?.SplashScreen).toMatchObject({
      launchAutoHide: false,
      showSpinner: false,
    });
  });

  it("allows overriding the native server URL per environment", async () => {
    process.env.CAP_SERVER_URL = "http://10.0.2.2:5000";

    const config = await loadConfig();

    expect(config.server).toEqual({
      url: "http://10.0.2.2:5000",
      cleartext: true,
    });
  });
});
