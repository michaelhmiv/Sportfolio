import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { apiRequest } from "@/lib/queryClient";

const PUSH_INSTALLATION_ID_STORAGE_KEY = "android_push_installation_id_v1";
const PUSH_LAST_TOKEN_STORAGE_KEY = "android_push_last_token_v1";
const PUSH_AUTO_PROMPTED_STORAGE_KEY = "android_push_auto_prompted_v2";
const PUSH_PERMISSION_STATUS_STORAGE_KEY = "android_push_permission_status_v2";
const LEGACY_PUSH_PROMPTED_STORAGE_KEY = "android_push_prompted_v1";

export const DEFAULT_ANDROID_PUSH_CHANNEL = {
  id: "sportfolio_general",
  name: "Sportfolio Alerts",
  description: "Boost, scout, portfolio, and market notifications from Sportfolio.",
  importance: 4 as const,
  visibility: 1 as const,
  lights: true,
  lightColor: "#3b82f6",
  vibration: true,
};

export type AndroidPushPermissionState = "unsupported" | "prompt" | "granted" | "denied";

export interface AndroidPushPermissionSnapshot {
  state: AndroidPushPermissionState;
  canPrompt: boolean;
  hasAutoPrompted: boolean;
  lastKnownState: AndroidPushPermissionState | null;
}

export interface AndroidPushRegistrationResult {
  state: AndroidPushPermissionState;
  prompted: boolean;
  registered: boolean;
}

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

function getStoredPermissionState(): AndroidPushPermissionState | null {
  const raw = safeStorageGet(PUSH_PERMISSION_STATUS_STORAGE_KEY);
  if (raw === "granted" || raw === "denied" || raw === "prompt") {
    return raw;
  }

  if (safeStorageGet(LEGACY_PUSH_PROMPTED_STORAGE_KEY) === "true") {
    return "prompt";
  }

  return null;
}

function setStoredPermissionState(state: AndroidPushPermissionState) {
  if (state === "unsupported") {
    safeStorageRemove(PUSH_PERMISSION_STATUS_STORAGE_KEY);
    return;
  }

  safeStorageSet(PUSH_PERMISSION_STATUS_STORAGE_KEY, state);
}

function normalizePermissionState(receive: string | undefined): AndroidPushPermissionState {
  // Android push permissions resolve to granted / denied / prompt on supported devices.
  // "unsupported" is reserved for the non-Android/non-native guard paths above.
  if (receive === "granted") return "granted";
  if (receive === "denied") return "denied";
  return "prompt";
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

export function hasAutoPromptedForPushPermission(): boolean {
  return safeStorageGet(PUSH_AUTO_PROMPTED_STORAGE_KEY) === "true";
}

export function markPushPermissionAutoPrompted() {
  safeStorageSet(PUSH_AUTO_PROMPTED_STORAGE_KEY, "true");
}

export async function ensureAndroidPushChannel() {
  if (!isAndroidNativePushSupported()) {
    return;
  }

  await PushNotifications.createChannel(DEFAULT_ANDROID_PUSH_CHANNEL).catch((error) => {
    console.warn("[MOBILE_PUSH] Could not create Android notification channel:", error);
  });
}

export async function getAndroidPushPermissionSnapshot(): Promise<AndroidPushPermissionSnapshot> {
  if (!isAndroidNativePushSupported()) {
    return {
      state: "unsupported",
      canPrompt: false,
      hasAutoPrompted: false,
      lastKnownState: null,
    };
  }

  const status = await PushNotifications.checkPermissions();
  const state = normalizePermissionState(status.receive);
  setStoredPermissionState(state);

  return {
    state,
    canPrompt: state === "prompt",
    hasAutoPrompted: hasAutoPromptedForPushPermission(),
    lastKnownState: getStoredPermissionState(),
  };
}

export async function registerForAndroidPushes(options?: {
  allowPrompt?: boolean;
  promptSource?: "auto" | "explicit";
  logLabel?: string;
}): Promise<AndroidPushRegistrationResult> {
  const allowPrompt = options?.allowPrompt ?? false;
  const promptSource = options?.promptSource ?? "explicit";
  const logLabel = options?.logLabel ?? "unknown";

  if (!isAndroidNativePushSupported()) {
    return { state: "unsupported", prompted: false, registered: false };
  }

  const permissionStatus = await PushNotifications.checkPermissions();
  let state = normalizePermissionState(permissionStatus.receive);
  let prompted = false;

  if (state === "prompt" && allowPrompt) {
    if (promptSource === "auto") {
      markPushPermissionAutoPrompted();
    }

    console.info(`[MOBILE_PUSH] Requesting Android notification permission (${logLabel})`);
    const requested = await PushNotifications.requestPermissions();
    state = normalizePermissionState(requested.receive);
    prompted = true;
  }

  setStoredPermissionState(state);

  if (state !== "granted") {
    console.info(
      `[MOBILE_PUSH] Android notification permission not granted (${logLabel}): ${state}`,
    );
    return { state, prompted, registered: false };
  }

  await ensureAndroidPushChannel();
  await PushNotifications.register();
  console.info(`[MOBILE_PUSH] Android push registration requested (${logLabel})`);
  return { state, prompted, registered: true };
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
