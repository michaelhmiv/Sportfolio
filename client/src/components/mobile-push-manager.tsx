import { useEffect, useRef } from "react";
import { PushNotifications } from "@capacitor/push-notifications";
import { useLocation } from "wouter";
import { normalizeInternalNotificationRoute } from "@shared/push-notifications";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  getPushInstallationId,
  hasPromptedForPushPermission,
  isAndroidNativePushSupported,
  markPushPermissionPrompted,
  setLastRegisteredPushToken,
} from "@/lib/mobile-push";

const PUSH_REGISTRATION_DELAY_MS = 12000;
const AUTH_BOOTSTRAP_ROUTES = new Set(["/login", "/auth/callback"]);

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

async function ensureAndroidPermissionAndRegister() {
  const permissionStatus = await PushNotifications.checkPermissions();
  let receive = permissionStatus.receive;

  if (receive === "prompt" && !hasPromptedForPushPermission()) {
    markPushPermissionPrompted();
    const requested = await PushNotifications.requestPermissions();
    receive = requested.receive;
  }

  if (receive !== "granted") {
    return false;
  }

  await PushNotifications.register();
  return true;
}

export function MobilePushManager() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const authRef = useRef<{ isAuthenticated: boolean; userId?: string }>({
    isAuthenticated,
    userId: user?.id,
  });
  const registrationAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    authRef.current = { isAuthenticated, userId: user?.id };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (isAuthenticated) return;
    registrationAttemptedRef.current = null;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAndroidNativePushSupported()) {
      return;
    }

    let registrationListener: { remove: () => Promise<void> } | null = null;
    let registrationErrorListener: { remove: () => Promise<void> } | null = null;
    let notificationListener: { remove: () => Promise<void> } | null = null;
    let actionListener: { remove: () => Promise<void> } | null = null;

    const attachListeners = async () => {
      registrationListener = await PushNotifications.addListener("registration", async (token) => {
        setLastRegisteredPushToken(token.value);

        if (!authRef.current.isAuthenticated || !authRef.current.userId) {
          return;
        }

        await apiRequest("POST", "/api/mobile/push/register", {
          token: token.value,
          platform: "android",
          deviceId: getPushInstallationId(),
          appVersion: import.meta.env.VITE_APP_VERSION || null,
          osVersion: navigator.userAgent,
          deviceModel: null,
        }).catch((error) => {
          console.warn("[MOBILE_PUSH] Failed to sync token with backend:", error);
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
          const route = resolveNotificationRoute(
            action.notification?.data as Record<string, unknown>,
          );
          navigate(route);
        },
      );
    };

    attachListeners();

    return () => {
      void registrationListener?.remove();
      void registrationErrorListener?.remove();
      void notificationListener?.remove();
      void actionListener?.remove();
    };
  }, [navigate, toast]);

  useEffect(() => {
    if (!isAndroidNativePushSupported()) return;
    if (isLoading || !isAuthenticated || !user?.id) return;
    if (AUTH_BOOTSTRAP_ROUTES.has(location)) return;
    if (registrationAttemptedRef.current === user.id) return;

    registrationAttemptedRef.current = user.id;
    const timer = window.setTimeout(() => {
      void ensureAndroidPermissionAndRegister().catch((error) => {
        console.warn("[MOBILE_PUSH] Could not register for notifications:", error);
      });
    }, PUSH_REGISTRATION_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [isAuthenticated, isLoading, location, user?.id]);

  return null;
}
