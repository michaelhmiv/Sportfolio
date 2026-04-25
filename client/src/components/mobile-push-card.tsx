import { App as CapacitorApp } from "@capacitor/app";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PUSH_NOTIFICATION_PREFERENCES,
  PUSH_NOTIFICATION_TYPES,
  type PushNotificationPreferenceMap,
  type PushNotificationType,
} from "@shared/push-notifications";
import { useToast } from "@/hooks/use-toast";
import { openAndroidNotificationSettings } from "@/lib/android-notification-settings";
import {
  getAndroidPushPermissionSnapshot,
  getPushInstallationId,
  isAndroidNativePushSupported,
  registerForAndroidPushes,
  type AndroidPushPermissionState,
} from "@/lib/mobile-push";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

type MobilePushStatusResponse = {
  providerConfigured: boolean;
  activeTokenCount: number;
  currentDevice: {
    deviceId: string | null;
    registered: boolean;
    lastRegisteredAt: string | null;
    lastSuccessfulAt: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
  };
  recentEvents: Array<{
    id: string;
    notificationType: string;
    title: string;
    deliveryStatus: string;
    createdAt: string;
    sentAt: string | null;
    route: string;
  }>;
};

type NotificationPreferencesResponse = {
  preferences: PushNotificationPreferenceMap;
};

const PUSH_LABELS: Record<PushNotificationType, string> = {
  scout_complete: "Scout completion",
  scout_capacity_available: "Scout capacity",
  boost_locking_soon: "Boost locking soon",
  boost_settled: "Boost settled",
  portfolio_movement: "Portfolio movement",
  order_filled: "Order filled",
  watchlist_news: "Watchlist news",
  watchlist_price_move: "Watchlist price move",
  premium_reward_available: "Premium reward",
  system_announcements: "System announcements",
};

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function getPermissionBadgeVariant(state: AndroidPushPermissionState) {
  if (state === "granted") return "secondary" as const;
  if (state === "denied") return "destructive" as const;
  return "outline" as const;
}

export function MobilePushCard() {
  const { toast } = useToast();
  const [permissionState, setPermissionState] = useState<AndroidPushPermissionState>(
    isAndroidNativePushSupported() ? "prompt" : "unsupported",
  );
  const deviceId = useMemo(() => getPushInstallationId(), []);
  const statusQueryKey = `/api/mobile/push/status${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ""}`;

  const refreshPermissionState = async () => {
    const snapshot = await getAndroidPushPermissionSnapshot();
    setPermissionState(snapshot.state);
    return snapshot;
  };

  useEffect(() => {
    void refreshPermissionState();
  }, []);

  useEffect(() => {
    if (!isAndroidNativePushSupported()) {
      return;
    }

    let handle: { remove: () => Promise<void> } | null = null;

    const attach = async () => {
      handle = await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        void refreshPermissionState();
        void queryClient.invalidateQueries({ queryKey: [statusQueryKey] });
      });
    };

    void attach();
    return () => {
      void handle?.remove();
    };
  }, [statusQueryKey]);

  const statusQuery = useQuery<MobilePushStatusResponse>({
    queryKey: [statusQueryKey],
    enabled: Boolean(deviceId),
  });

  const preferencesQuery = useQuery<NotificationPreferencesResponse>({
    queryKey: ["/api/notifications/preferences"],
  });

  const registerMutation = useMutation({
    mutationFn: async (promptSource: "auto" | "explicit" = "explicit") => {
      const result = await registerForAndroidPushes({
        allowPrompt: true,
        promptSource,
        logLabel: "profile_settings",
      });
      await refreshPermissionState();
      return result;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: [statusQueryKey] });
      toast({
        title: result.registered ? "Notifications enabled" : "Notifications not enabled",
        description: result.registered
          ? "Sportfolio will now register this device for Android pushes."
          : result.state === "denied"
            ? "Android notifications are blocked for this app."
            : "Permission is still pending for this device.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not enable notifications",
        description: error?.message || "Android push registration failed.",
        variant: "destructive",
      });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: async () => {
      const opened = await openAndroidNotificationSettings();
      if (!opened) {
        throw new Error("Android notification settings could not be opened.");
      }
      return opened;
    },
    onSuccess: () => {
      toast({
        title: "Opened Android settings",
        description: "Enable notifications there, then return to Sportfolio.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not open Android settings",
        description: error?.message || "Open the Sportfolio app settings manually.",
        variant: "destructive",
      });
    },
  });

  const preferenceMutation = useMutation({
    mutationFn: async (input: { notificationType: PushNotificationType; enabled: boolean }) => {
      const current = preferencesQuery.data?.preferences ?? DEFAULT_PUSH_NOTIFICATION_PREFERENCES;
      const response = await apiRequest("PUT", "/api/notifications/preferences", {
        preferences: {
          ...current,
          [input.notificationType]: input.enabled,
        },
      });
      return (await response.json()) as NotificationPreferencesResponse;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/notifications/preferences"], result);
      toast({
        title: "Notification preferences updated",
        description: "Your Android push settings were saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not update preferences",
        description: error?.message || "The notification preference could not be saved.",
        variant: "destructive",
      });
    },
  });

  const preferences = preferencesQuery.data?.preferences ?? DEFAULT_PUSH_NOTIFICATION_PREFERENCES;
  const status = statusQuery.data;
  const registeredOnThisDevice = status?.currentDevice.registered ?? false;
  const providerConfigured = status?.providerConfigured ?? false;

  return (
    <Card variant="terminal" data-testid="card-mobile-push">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="terminal-kicker">Android Notifications</p>
            <CardTitle className="terminal-heading mt-2 flex items-center gap-2 text-base">
              <Bell className="h-5 w-5 text-primary" />
              Push Alerts
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Control Android notification permission, device registration, and per-alert delivery
              without leaving your Sportfolio profile.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={getPermissionBadgeVariant(permissionState)}
              className="font-mono text-[10px] uppercase"
            >
              Permission: {permissionState}
            </Badge>
            <Badge
              variant={registeredOnThisDevice ? "secondary" : "outline"}
              className="font-mono text-[10px] uppercase"
            >
              {registeredOnThisDevice ? "This device linked" : "Device not linked"}
            </Badge>
            <Badge
              variant={providerConfigured ? "secondary" : "outline"}
              className="font-mono text-[10px] uppercase"
            >
              {providerConfigured ? "Delivery ready" : "Server delivery offline"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isAndroidNativePushSupported() ? (
          <div className="terminal-empty border border-dashed border-border p-4 text-sm text-muted-foreground">
            Android push controls are only available inside the native Android app.
          </div>
        ) : (
          <>
            <div className="terminal-shell space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <Smartphone className="h-4 w-4 text-primary" />
                    Current device
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Active tokens: {status?.activeTokenCount ?? 0}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last registered:{" "}
                    {formatTimestamp(status?.currentDevice.lastRegisteredAt ?? null)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last successful send:{" "}
                    {formatTimestamp(status?.currentDevice.lastSuccessfulAt ?? null)}
                  </div>
                  {status?.currentDevice.lastError && (
                    <div className="text-xs text-destructive">
                      Last device error: {status.currentDevice.lastError}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {permissionState !== "granted" ? (
                    <Button
                      variant="terminal"
                      onClick={() => registerMutation.mutate("explicit")}
                      disabled={registerMutation.isPending}
                      data-testid="button-enable-android-push"
                    >
                      {registerMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Enabling
                        </>
                      ) : (
                        "Enable Notifications"
                      )}
                    </Button>
                  ) : !registeredOnThisDevice ? (
                    <Button
                      variant="terminal"
                      onClick={() => registerMutation.mutate("explicit")}
                      disabled={registerMutation.isPending}
                    >
                      Register This Device
                    </Button>
                  ) : null}
                  {(permissionState === "denied" || permissionState === "prompt") && (
                    <Button
                      variant="terminalOutline"
                      onClick={() => settingsMutation.mutate()}
                      disabled={settingsMutation.isPending}
                    >
                      {settingsMutation.isPending ? "Opening…" : "Open Android Settings"}
                    </Button>
                  )}
                  <Button
                    variant="terminalOutline"
                    onClick={() => {
                      void refreshPermissionState();
                      void queryClient.invalidateQueries({ queryKey: [statusQueryKey] });
                    }}
                    disabled={statusQuery.isFetching}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </div>
              {!providerConfigured && (
                <p className="text-xs text-muted-foreground">
                  Sportfolio is missing server-side Firebase credentials, so notifications can be
                  registered on-device but delivery will stay paused until runtime env is
                  configured.
                </p>
              )}
            </div>

            <div className="space-y-3">
              {PUSH_NOTIFICATION_TYPES.map((notificationType) => (
                <div
                  key={notificationType}
                  className="terminal-shell flex items-center justify-between gap-3 p-3"
                >
                  <div>
                    <div className="text-sm font-medium">{PUSH_LABELS[notificationType]}</div>
                    <div className="text-xs text-muted-foreground">{notificationType}</div>
                  </div>
                  <Switch
                    checked={preferences[notificationType]}
                    onCheckedChange={(checked) =>
                      preferenceMutation.mutate({ notificationType, enabled: checked })
                    }
                    disabled={preferenceMutation.isPending}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent push events
              </div>
              {statusQuery.isLoading ? (
                <div className="terminal-empty px-4 py-4 text-sm text-muted-foreground">
                  Loading Android push diagnostics...
                </div>
              ) : status?.recentEvents.length ? (
                status.recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className="terminal-shell flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{event.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {event.notificationType} · {event.deliveryStatus} · {event.route}
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{formatTimestamp(event.sentAt || event.createdAt)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="terminal-empty border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No push events recorded yet for this account.
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
