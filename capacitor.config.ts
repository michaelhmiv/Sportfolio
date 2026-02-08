import type { CapacitorConfig } from "@capacitor/cli";

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

export default config;
