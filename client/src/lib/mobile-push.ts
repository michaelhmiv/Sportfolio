import { Capacitor } from "@capacitor/core";
import { apiRequest } from "@/lib/queryClient";

const PUSH_INSTALLATION_ID_STORAGE_KEY = "android_push_installation_id_v1";
const PUSH_LAST_TOKEN_STORAGE_KEY = "android_push_last_token_v1";
const PUSH_PROMPTED_STORAGE_KEY = "android_push_prompted_v1";

export function isAndroidNativePushSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function safeStorageGet(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function safeStorageRemove(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // noop
  }
}

function createInstallationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `install_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function getPushInstallationId(): string | null {
  if (!isAndroidNativePushSupported()) {
    return null;
  }

  let existing = safeStorageGet(PUSH_INSTALLATION_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  existing = createInstallationId();
  safeStorageSet(PUSH_INSTALLATION_ID_STORAGE_KEY, existing);
  return existing;
}

export function hasPromptedForPushPermission(): boolean {
  return safeStorageGet(PUSH_PROMPTED_STORAGE_KEY) === "true";
}

export function markPushPermissionPrompted() {
  safeStorageSet(PUSH_PROMPTED_STORAGE_KEY, "true");
}

export function getLastRegisteredPushToken(): string | null {
  return safeStorageGet(PUSH_LAST_TOKEN_STORAGE_KEY);
}

export function setLastRegisteredPushToken(token: string) {
  safeStorageSet(PUSH_LAST_TOKEN_STORAGE_KEY, token);
}

export function clearLastRegisteredPushToken() {
  safeStorageRemove(PUSH_LAST_TOKEN_STORAGE_KEY);
}

export async function unregisterPushTokenOnLogout() {
  if (!isAndroidNativePushSupported()) {
    return;
  }

  const token = getLastRegisteredPushToken();
  const deviceId = getPushInstallationId();

  if (!token && !deviceId) {
    return;
  }

  await apiRequest("POST", "/api/mobile/push/unregister", {
    token: token || undefined,
    deviceId: deviceId || undefined,
    reason: "logout",
  }).catch((error) => {
    console.warn("[MOBILE_PUSH] Could not unregister token during logout:", error);
  });

  clearLastRegisteredPushToken();
}
