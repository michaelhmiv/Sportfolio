import type { CapacitorConfig } from "@capacitor/cli";

const nativeServerUrl = process.env.CAP_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "sportfolio.market",
  appName: "Sportfolio",
  webDir: "dist/public",
  ios: {
    path: "mobile/ios",
  },
  android: {
    path: "mobile/android",
  },
};

if (nativeServerUrl) {
  config.server = {
    url: nativeServerUrl,
    cleartext: nativeServerUrl.startsWith("http://"),
  };
}

export default config;
