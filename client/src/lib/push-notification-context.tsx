import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { isNativeAndroid } from "@/lib/native-platform";

type PushPermissionStatus =
  | "unsupported"
  | "unknown"
  | "prompt"
  | "prompt-with-rationale"
  | "granted"
  | "denied";

type PushNotificationContextValue = {
  isSupported: boolean;
  permissionStatus: PushPermissionStatus;
  pushToken: string | null;
  isRegistering: boolean;
  requestPermissionAndRegister: () => Promise<boolean>;
  refreshPermissionStatus: () => Promise<PushPermissionStatus>;
  unregisterCurrentToken: () => Promise<void>;
};

const PushNotificationContext = createContext<PushNotificationContextValue | null>(null);

const DEVICE_ID_STORAGE_KEY = "sportfolio.push.device-id";
const TOKEN_STORAGE_KEY = "sportfolio.push.last-token";
const APP_VERSION =
  (typeof import.meta.env.VITE_APP_VERSION === "string" && import.meta.env.VITE_APP_VERSION) ||
  (typeof import.meta.env.VITE_COMMIT_SHA === "string" && import.meta.env.VITE_COMMIT_SHA) ||
  "unknown";

function getOrCreateDeviceId() {
  const cached = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (cached) {
    return cached;
  }

  const next =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
}

function normalizePermissionStatus(value?: string | null): PushPermissionStatus {
  if (
    value === "prompt" ||
    value === "prompt-with-rationale" ||
    value === "granted" ||
    value === "denied"
  ) {
    return value;
  }
  return "unknown";
}

function navigateToDeepLink(path: string) {
  if (!path) {
    return;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    window.location.assign(path);
    return;
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  window.history.pushState({}, "", normalized);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function registerTokenWithBackend(input: {
  token: string;
  permissionStatus: PushPermissionStatus;
}) {
  await apiRequest("POST", "/api/account/notifications/push/register", {
    platform: "android",
    token: input.token,
    deviceId: getOrCreateDeviceId(),
    appVersion: APP_VERSION,
    permissionStatus: input.permissionStatus,
  });
}

export function PushNotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const isSupported = isNativeAndroid() && Capacitor.isNativePlatform();
  const [permissionStatus, setPermissionStatus] = useState<PushPermissionStatus>(
    isSupported ? "unknown" : "unsupported",
  );
  const [pushToken, setPushToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY),
  );
  const [isRegistering, setIsRegistering] = useState(false);
  const activePermissionRef = useRef<PushPermissionStatus>(permissionStatus);

  useEffect(() => {
    activePermissionRef.current = permissionStatus;
  }, [permissionStatus]);

  const refreshPermissionStatus = useCallback(async (): Promise<PushPermissionStatus> => {
    if (!isSupported) {
      return "unsupported";
    }

    try {
      const permission = await PushNotifications.checkPermissions();
      const normalized = normalizePermissionStatus(permission.receive);
      setPermissionStatus(normalized);
      return normalized;
    } catch (error) {
      console.error("[Push] Failed to check permission:", error);
      setPermissionStatus("unknown");
      return "unknown";
    }
  }, [isSupported]);

  const ensureRegistration = useCallback(async () => {
    if (!isSupported || !isAuthenticated || !user?.id) {
      return false;
    }

    const latestPermission = await refreshPermissionStatus();
    if (latestPermission !== "granted") {
      return false;
    }

    try {
      setIsRegistering(true);
      await PushNotifications.register();
      return true;
    } catch (error) {
      console.error("[Push] Registration failed:", error);
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [isAuthenticated, isSupported, refreshPermissionStatus, user?.id]);

  const requestPermissionAndRegister = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    const current = await refreshPermissionStatus();
    if (current !== "granted") {
      try {
        const request = await PushNotifications.requestPermissions();
        const normalized = normalizePermissionStatus(request.receive);
        setPermissionStatus(normalized);
      } catch (error) {
        console.error("[Push] Permission request failed:", error);
        return false;
      }
    }

    return ensureRegistration();
  }, [ensureRegistration, isSupported, refreshPermissionStatus]);

  const unregisterCurrentToken = useCallback(async () => {
    const token = pushToken || localStorage.getItem(TOKEN_STORAGE_KEY);
    const deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY) || getOrCreateDeviceId();

    try {
      await apiRequest("POST", "/api/account/notifications/push/unregister", {
        token: token || undefined,
        deviceId,
      });
    } catch (error) {
      console.error("[Push] Failed to unregister token:", error);
    }
  }, [pushToken]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    let removed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const registerListeners = async () => {
      const registrationHandle = await PushNotifications.addListener("registration", (token) => {
        if (removed) return;
        setPushToken(token.value);
        localStorage.setItem(TOKEN_STORAGE_KEY, token.value);

        if (!isAuthenticated || !user?.id) {
          return;
        }

        void registerTokenWithBackend({
          token: token.value,
          permissionStatus: activePermissionRef.current,
        }).catch((error) => {
          console.error("[Push] Failed to register token with backend:", error);
        });
      });
      handles.push(registrationHandle);

      const registrationErrorHandle = await PushNotifications.addListener(
        "registrationError",
        (error) => {
          if (removed) return;
          console.error("[Push] Native registration error:", error);
        },
      );
      handles.push(registrationErrorHandle);

      const actionHandle = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          if (removed) return;
          const deepLink = String(action.notification?.data?.deepLink || "").trim();
          if (deepLink) {
            navigateToDeepLink(deepLink);
          }
        },
      );
      handles.push(actionHandle);

      const appStateHandle = await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (removed || !isActive) {
          return;
        }

        void (async () => {
          const latest = await refreshPermissionStatus();
          if (latest === "granted" && isAuthenticated && user?.id) {
            await ensureRegistration();
          }
        })();
      });
      handles.push(appStateHandle);
    };

    registerListeners();

    return () => {
      removed = true;
      void Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
    };
  }, [ensureRegistration, isAuthenticated, isSupported, refreshPermissionStatus, user?.id]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    if (!isAuthenticated || !user?.id) {
      void unregisterCurrentToken();
      return;
    }

    void ensureRegistration();
  }, [ensureRegistration, isAuthenticated, isSupported, unregisterCurrentToken, user?.id]);

  const value = useMemo<PushNotificationContextValue>(
    () => ({
      isSupported,
      permissionStatus,
      pushToken,
      isRegistering,
      requestPermissionAndRegister,
      refreshPermissionStatus,
      unregisterCurrentToken,
    }),
    [
      isRegistering,
      isSupported,
      permissionStatus,
      pushToken,
      refreshPermissionStatus,
      requestPermissionAndRegister,
      unregisterCurrentToken,
    ],
  );

  return (
    <PushNotificationContext.Provider value={value}>{children}</PushNotificationContext.Provider>
  );
}

export function usePushNotificationLifecycle() {
  const context = useContext(PushNotificationContext);
  if (!context) {
    throw new Error("usePushNotificationLifecycle must be used inside PushNotificationProvider");
  }
  return context;
}
