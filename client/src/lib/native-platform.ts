import { Capacitor } from "@capacitor/core";

export function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function isNativeAndroid() {
  return Capacitor.getPlatform() === "android";
}

export function isNativeIOS() {
  return Capacitor.getPlatform() === "ios";
}

export function getClientPlatform(): "android" | "ios" | "web" {
  if (!Capacitor.isNativePlatform()) {
    return "web";
  }

  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}
