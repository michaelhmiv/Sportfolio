import { App as CapacitorApp } from "@capacitor/app";
import { useCallback, useEffect, useRef } from "react";
import { PushNotifications } from "@capacitor/push-notifications";
import { useLocation } from "wouter";
import { normalizeInternalNotificationRoute } from "@shared/push-notifications";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ensureAndroidPushChannels,
  getDefaultAndroidPushChannelId,
  getNativeAppVersion,
  getPushInstallationId,
  isAndroidNativePushSupported,
  hasAutoPromptedForPushPermission,
  registerForAndroidPushes,
  setLastRegisteredPushToken,
} from "@/lib/mobile-push";

const AUTH_BOOTSTRAP_ROUTES = new Set(["/login", "/auth/callback"]);
const PUSH_COLD_START_ROUTE_STORAGE_KEY = "android_push_cold_start_route_v1";
const PUSH_LAST_OPEN_EVENT_ID_STORAGE_KEY = "android_push_last_open_event_id_v1";

function resolveNotificationRoute(
  data: Record<string, unknown> | null | undefined,
  fallback = "/",
): string {
  const explicitRoute = normalizeInternalNotificationRoute(data?.route);
  if (explicitRoute) {
    return explicitRoute;
  }

  const entityType = String(data?.entityType || "").toLowerCase();
  const entityId = String(data?.entityId || "").trim();
  if (entityType === "player" && entityId) {
    const playerRoute = normalizeInternalNotificationRoute(`/player/${entityId}`);
    if (playerRoute) {
      return playerRoute;
    }
  }

  return fallback;
}

export function MobilePushManager() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const authRef = useRef<{ isAuthenticated: boolean; userId?: string }>({
    isAuthenticated,
    userId: user?.id,
  });
  const registrationInFlightRef = useRef(false);

  const invalidatePushQueries = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "/api/notifications/preferences",
    });
    void queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/mobile/push/status"),
    });
  }, []);

  const navigateFromPushPayload = useCallback(
    (payload: Record<string, unknown> | null | undefined, fallback = "/") => {
      const route = resolveNotificationRoute(payload, fallback);
      navigate(route);
    },
    [navigate],
  );

  const markPushOpened = useCallback(
    async (data: Record<string, unknown> | null | undefined) => {
      const eventId = typeof data?.eventId === "string" ? data.eventId.trim() : "";
      if (!eventId || typeof window === "undefined") return;

      const alreadyOpened = window.sessionStorage.getItem(PUSH_LAST_OPEN_EVENT_ID_STORAGE_KEY);
      if (alreadyOpened === eventId) return;

      try {
        await apiRequest("POST", "/api/mobile/push/opened", {
          eventId,
          openedFrom: "tap",
          route: resolveNotificationRoute(data),
        });
        window.sessionStorage.setItem(PUSH_LAST_OPEN_EVENT_ID_STORAGE_KEY, eventId);
        invalidatePushQueries();
      } catch (error) {
        console.warn("[MOBILE_PUSH] Failed to mark notification as opened:", error);
      }
    },
    [invalidatePushQueries],
  );

  useEffect(() => {
    authRef.current = { isAuthenticated, userId: user?.id };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (isAuthenticated) return;
    registrationInFlightRef.current = false;
  }, [isAuthenticated]);

  const syncAndroidPushRegistration = useCallback(
    async (options: {
      allowPrompt: boolean;
      promptSource: "auto" | "explicit";
      logLabel: string;
    }) => {
      if (!isAndroidNativePushSupported()) return;
      if (registrationInFlightRef.current) return;
      if (!authRef.current.isAuthenticated || !authRef.current.userId) return;

      registrationInFlightRef.current = true;
      try {
        const result = await registerForAndroidPushes(options);
        if (!result.registered) {
          return;
        }

        invalidatePushQueries();
      } catch (error) {
        console.warn("[MOBILE_PUSH] Could not synchronize Android push registration:", error);
      } finally {
        registrationInFlightRef.current = false;
      }
    },
    [invalidatePushQueries],
  );

  useEffect(() => {
    if (!isAndroidNativePushSupported()) {
      return;
    }

    let registrationListener: { remove: () => Promise<void> } | null = null;
    let registrationErrorListener: { remove: () => Promise<void> } | null = null;
    let notificationListener: { remove: () => Promise<void> } | null = null;
    let actionListener: { remove: () => Promise<void> } | null = null;
    let appStateListener: { remove: () => Promise<void> } | null = null;

    const attachListeners = async () => {
      await ensureAndroidPushChannels();

      const launchNotification = await PushNotifications.getDeliveredNotifications().catch(
        () => null,
      );
      const latestLaunchNotification = launchNotification?.notifications?.at(-1);
      const coldStartRoute = resolveNotificationRoute(
        latestLaunchNotification?.data as Record<string, unknown> | undefined,
      );
      if (coldStartRoute && typeof window !== "undefined") {
        window.sessionStorage.setItem(PUSH_COLD_START_ROUTE_STORAGE_KEY, coldStartRoute);
      }

      registrationListener = await PushNotifications.addListener("registration", async (token) => {
        setLastRegisteredPushToken(token.value);
        const appVersion = await getNativeAppVersion();

        if (!authRef.current.isAuthenticated || !authRef.current.userId) {
          return;
        }

        await apiRequest("POST", "/api/mobile/push/register", {
          token: token.value,
          platform: "android",
          deviceId: getPushInstallationId(),
          appVersion: appVersion || import.meta.env.VITE_APP_VERSION || null,
          osVersion: navigator.userAgent,
          deviceModel: null,
          channelId: getDefaultAndroidPushChannelId(),
        })
          .catch((error) => {
            console.warn("[MOBILE_PUSH] Failed to sync token with backend:", error);
          })
          .finally(() => {
            invalidatePushQueries();
          });
      });

      registrationErrorListener = await PushNotifications.addListener(
        "registrationError",
        (error) => {
          console.error("[MOBILE_PUSH] Push registration error:", error);
        },
      );

      notificationListener = await PushNotifications.addListener(
        "pushNotificationReceived",
        (notification) => {
          if (!notification.title && !notification.body) {
            return;
          }
          toast({
            title: notification.title || "Sportfolio",
            description: notification.body || "You have a new update.",
          });
        },
      );

      actionListener = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          const data = action.notification?.data as Record<string, unknown>;
          void markPushOpened(data);
          navigateFromPushPayload(data);
        },
      );

      appStateListener = await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;

        const canPromptAutomatically =
          authRef.current.isAuthenticated &&
          user?.hasSeenOnboarding !== false &&
          !hasAutoPromptedForPushPermission();

        void syncAndroidPushRegistration({
          allowPrompt: canPromptAutomatically,
          promptSource: "auto",
          logLabel: "app_resume",
        });
      });
    };

    void attachListeners();

    return () => {
      void registrationListener?.remove();
      void registrationErrorListener?.remove();
      void notificationListener?.remove();
      void actionListener?.remove();
      void appStateListener?.remove();
    };
  }, [
    invalidatePushQueries,
    markPushOpened,
    navigateFromPushPayload,
    syncAndroidPushRegistration,
    toast,
    user?.hasSeenOnboarding,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingRoute = window.sessionStorage.getItem(PUSH_COLD_START_ROUTE_STORAGE_KEY);
    if (!pendingRoute) return;
    window.sessionStorage.removeItem(PUSH_COLD_START_ROUTE_STORAGE_KEY);
    navigate(pendingRoute);
  }, [navigate]);

  useEffect(() => {
    if (!isAndroidNativePushSupported()) return;
    if (isLoading || !isAuthenticated || !user?.id) return;
    if (AUTH_BOOTSTRAP_ROUTES.has(location)) return;
    if (user.hasSeenOnboarding === false && location === "/onboarding") return;

    const allowPrompt = user.hasSeenOnboarding !== false && !hasAutoPromptedForPushPermission();

    void syncAndroidPushRegistration({
      allowPrompt,
      promptSource: "auto",
      logLabel: "post_auth",
    });
  }, [
    isAuthenticated,
    isLoading,
    location,
    syncAndroidPushRegistration,
    user?.hasSeenOnboarding,
    user?.id,
  ]);

  return null;
}
