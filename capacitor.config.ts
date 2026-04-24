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
  plugins: {
    SplashScreen: {
      // Controlled programmatically from JS — hide after auth resolves (P3 — 7.1)
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#0f1420",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      // Set in JS after the app loads (P1 — 1.1)
      style: "LIGHT",
      backgroundColor: "#0f1420",
      overlaysWebView: true,
    },
    Keyboard: {
      resize: "body",
      style: "dark",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

if (nativeServerUrl) {
  config.server = {
    url: nativeServerUrl,
    cleartext: nativeServerUrl.startsWith("http://"),
  };
}

export default config;
