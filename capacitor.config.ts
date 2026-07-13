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
      // Runtime theme coordination in App.tsx applies readable icon and background colors.
      style: "DEFAULT",
      backgroundColor: "#0f1420",
      overlaysWebView: true,
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
      // Runtime theme coordination in App.tsx applies the active light/dark keyboard style.
      style: "DEFAULT",
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
