import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, Send, ShieldCheck, Smartphone } from "lucide-react";
import type {
  NotificationCategory,
  NotificationCategoryMeta,
  NotificationPreferences,
} from "@shared/notifications";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePushNotificationLifecycle } from "@/lib/push-notification-context";

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

function toPermissionLabel(value: string) {
  switch (value) {
    case "granted":
      return "Granted";
    case "denied":
      return "Denied";
    case "prompt-with-rationale":
      return "Needs prompt (rationale)";
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
  const push = usePushNotificationLifecycle();

  const { data, isLoading } = useQuery<NotificationSettingsResponse>({
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

  const requestPermission = async () => {
    const granted = await push.requestPermissionAndRegister();
    if (!granted) {
      toast({
        title: "Permission not granted",
        description: "Android notifications are still disabled at the OS level.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Notifications enabled",
      description: "Android push permission and token registration completed.",
    });
    void queryClient.invalidateQueries({ queryKey: ["/api/account/notifications"] });
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
            <CardTitle className="terminal-heading mt-2 flex items-center gap-2 text-base">
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
        {isLoading || !settings ? (
          <div className="terminal-empty px-4 py-4 text-sm text-muted-foreground">
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
                  checked={settings.pushEnabled}
                  onCheckedChange={handleMasterToggle}
                  disabled={updateSettingsMutation.isPending}
                  data-testid="switch-notifications-master"
                />
              </div>

              <div className="rounded-sm border border-border/70 bg-background/50 p-3 text-xs">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  OS Permission: {toPermissionLabel(push.permissionStatus)}
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
                      !push.isSupported || push.isRegistering || push.permissionStatus === "granted"
                    }
                    data-testid="button-enable-native-notifications"
                  >
                    {push.isRegistering ? (
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
                      checked={checked}
                      onCheckedChange={(value) => handleCategoryToggle(category.id, value)}
                      disabled={updateSettingsMutation.isPending}
                      data-testid={`switch-notification-category-${category.id}`}
                    />
                  </div>
                );
              })}
            </div>

            {!push.isSupported && (
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
