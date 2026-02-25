import type { CapacitorConfig } from "@capacitor/cli";

const nativeServerUrl =
  process.env.CAP_SERVER_URL || process.env.PUBLIC_SITE_URL || "https://www.sportfolio.market";

const config: CapacitorConfig = {
  appId: "sportfolio.market",
  appName: "Sportfolio",
  webDir: "dist/public",
  server: {
    url: nativeServerUrl,
    cleartext: nativeServerUrl.startsWith("http://"),
  },
  ios: {
    path: "mobile/ios",
  },
  android: {
    path: "mobile/android",
  },
};

export default config;
