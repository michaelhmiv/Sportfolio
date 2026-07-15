import { App as CapacitorApp } from "@capacitor/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, Send, ShieldCheck, Smartphone } from "lucide-react";
import type {
  NotificationCategory,
  NotificationCategoryMeta,
  NotificationPreferences,
} from "@shared/notifications";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { openAndroidNotificationSettings } from "@/lib/android-notification-settings";
import {
  getAndroidPushPermissionSnapshot,
  isAndroidNativePushSupported,
  registerForAndroidPushes,
  type AndroidPushPermissionState,
} from "@/lib/mobile-push";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type NotificationSettingsResponse = {
  settings: {
    pushEnabled: boolean;
    categoryPreferences: NotificationPreferences;
  };
  categories: NotificationCategoryMeta[];
  devices?: Array<{
    id: string;
    platform: string;
    permissionStatus: string;
    enabled: boolean;
    invalidatedAt: string | null;
    lastSeenAt: string;
  }>;
};

type NotificationSettingsPatch = {
  pushEnabled?: boolean;
  categoryPreferences?: Partial<Record<NotificationCategory, boolean>>;
};

function toPermissionLabel(value: AndroidPushPermissionState) {
  switch (value) {
    case "granted":
      return "Granted";
    case "denied":
      return "Denied";
    case "prompt":
      return "Prompt required";
    case "unsupported":
      return "Unsupported on this platform";
    default:
      return "Unknown";
  }
}

export function NotificationSettingsCard() {
  const { toast } = useToast();
  const isSupported = isAndroidNativePushSupported();
  const [permissionState, setPermissionState] = useState<AndroidPushPermissionState>(
    isSupported ? "prompt" : "unsupported",
  );

  const refreshPermissionState = useCallback(async () => {
    const snapshot = await getAndroidPushPermissionSnapshot();
    setPermissionState(snapshot.state);
    return snapshot.state;
  }, []);

  useEffect(() => {
    void refreshPermissionState();
  }, [refreshPermissionState]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    let handle: { remove: () => Promise<void> } | null = null;

    const attach = async () => {
      handle = await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        void refreshPermissionState();
      });
    };

    void attach();
    return () => {
      void handle?.remove();
    };
  }, [isSupported, refreshPermissionState]);

  const { data, isLoading, isError } = useQuery<NotificationSettingsResponse>({
    queryKey: ["/api/account/notifications"],
  });

  const settings = data?.settings;
  const categories = data?.categories || [];
  const activeDevices = useMemo(
    () => (data?.devices || []).filter((device) => device.enabled && !device.invalidatedAt),
    [data?.devices],
  );

  const updateSettingsMutation = useMutation({
    mutationFn: async (patch: NotificationSettingsPatch) => {
      const response = await apiRequest("PUT", "/api/account/notifications", patch);
      return (await response.json()) as NotificationSettingsResponse;
    },
    onSuccess: (response) => {
      queryClient.setQueryData(["/api/account/notifications"], response);
    },
    onError: (error: any) => {
      toast({
        title: "Could not update notifications",
        description: error?.message || "Your settings could not be saved.",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (category: NotificationCategory) => {
      const response = await apiRequest("POST", "/api/account/notifications/test", { category });
      return response.json() as Promise<{ sent: boolean }>;
    },
    onSuccess: (result) => {
      toast({
        title: result.sent ? "Test sent" : "Test queued",
        description: result.sent
          ? "Check your Android device for the push notification."
          : "No active device token accepted this test payload.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Test failed",
        description: error?.message || "Could not send a test notification.",
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const result = await registerForAndroidPushes({
        allowPrompt: true,
        promptSource: "explicit",
        logLabel: "notification_settings_card",
      });
      await refreshPermissionState();
      return result;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/account/notifications"] }),
        queryClient.invalidateQueries({
          predicate: (query) =>
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith("/api/mobile/push/status"),
        }),
      ]);
      toast({
        title: result.registered ? "Notifications enabled" : "Permission not granted",
        description: result.registered
          ? "Android push permission and registration completed."
          : result.state === "denied"
            ? "Android notifications are still disabled at the OS level."
            : "Permission is still pending for this device.",
        variant: result.registered ? "default" : "destructive",
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

  const openSettingsMutation = useMutation({
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

  const handleMasterToggle = (checked: boolean) => {
    updateSettingsMutation.mutate({ pushEnabled: checked });
  };

  const handleCategoryToggle = (category: NotificationCategory, checked: boolean) => {
    updateSettingsMutation.mutate({
      categoryPreferences: {
        [category]: checked,
      },
    });
  };

  const requestPermission = () => {
    registerMutation.mutate();
  };

  const selectedTestCategory: NotificationCategory =
    (categories.find((category) => settings?.categoryPreferences?.[category.id])
      ?.id as NotificationCategory) || "system_operational";

  return (
    <Card variant="terminal" data-testid="card-notification-settings">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="terminal-kicker">Notification Settings</p>
            <CardTitle
              role="heading"
              aria-level={2}
              className="terminal-heading mt-2 flex items-center gap-2 text-base"
            >
              <Bell className="h-5 w-5 text-primary" />
              Push Categories
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Control every push category from your profile. Android delivery is native-app only;
              web still saves your preferences.
            </p>
          </div>
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {settings?.pushEnabled ? "Push On" : "Push Off"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <div
            role="alert"
            className="terminal-empty border border-destructive/40 px-4 py-4 text-sm text-destructive"
          >
            Could not load notification settings. Refresh this page to try again.
          </div>
        ) : isLoading || !settings ? (
          <div
            role="status"
            aria-live="polite"
            className="terminal-empty px-4 py-4 text-sm text-muted-foreground"
          >
            Loading notification settings...
          </div>
        ) : (
          <>
            <div className="terminal-shell space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Master Push Toggle</div>
                  <div className="text-xs text-muted-foreground">
                    Disable this to mute all push categories instantly.
                  </div>
                </div>
                <Switch
                  aria-label="Enable all push notifications"
                  checked={settings.pushEnabled}
                  onCheckedChange={handleMasterToggle}
                  disabled={updateSettingsMutation.isPending}
                  data-testid="switch-notifications-master"
                />
              </div>

              <div className="rounded-sm border border-border/70 bg-background/50 p-3 text-xs">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  OS Permission: {toPermissionLabel(permissionState)}
                </div>
                <div className="mt-1 text-muted-foreground">
                  Active devices: {activeDevices.length}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="terminalOutline"
                    className="gap-2"
                    onClick={requestPermission}
                    disabled={
                      !isSupported || registerMutation.isPending || permissionState === "granted"
                    }
                    data-testid="button-enable-native-notifications"
                  >
                    {registerMutation.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Enabling
                      </>
                    ) : (
                      <>
                        <Smartphone className="h-3.5 w-3.5" />
                        Enable Notifications
                      </>
                    )}
                  </Button>

                  {(permissionState === "denied" || permissionState === "prompt") && (
                    <Button
                      size="sm"
                      variant="terminalOutline"
                      className="gap-2"
                      onClick={() => openSettingsMutation.mutate()}
                      disabled={openSettingsMutation.isPending}
                      data-testid="button-open-native-notification-settings"
                    >
                      {openSettingsMutation.isPending ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Opening
                        </>
                      ) : (
                        "Open Android Settings"
                      )}
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="terminalOutline"
                    className="gap-2"
                    onClick={() => testMutation.mutate(selectedTestCategory)}
                    disabled={testMutation.isPending}
                    data-testid="button-send-notification-test"
                  >
                    {testMutation.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Sending
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        Send Test Notification
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-sm border border-border/70 p-3">
              {categories.map((category) => {
                const checked = Boolean(settings.categoryPreferences?.[category.id]);
                return (
                  <div
                    key={category.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-sm px-2 py-1.5",
                      !settings.pushEnabled && "opacity-70",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{category.label}</div>
                      <div className="text-xs text-muted-foreground">
                        Default: {category.defaultEnabled ? "On" : "Off"}
                      </div>
                    </div>
                    <Switch
                      aria-label={`${category.label} notifications`}
                      checked={checked}
                      onCheckedChange={(value) => handleCategoryToggle(category.id, value)}
                      disabled={updateSettingsMutation.isPending}
                      data-testid={`switch-notification-category-${category.id}`}
                    />
                  </div>
                );
              })}
            </div>

            {!isSupported && (
              <div className="flex items-start gap-2 rounded-sm border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Push delivery is available in the Android app. These category settings still save to
                your account and apply when you sign in on Android.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
