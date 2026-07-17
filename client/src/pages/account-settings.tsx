import { Settings, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { NotificationSettingsCard } from "@/components/notification-settings-card";
import { MobilePushCard } from "@/components/mobile-push-card";
import { CliAccessCard } from "@/components/cli-access-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccountSettings() {
  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-bold sm:text-2xl">Account Settings</h1>
        </div>
        <NotificationSettingsCard />
        <MobilePushCard />
        <CliAccessCard />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                Account Controls
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Permanently remove your account and associated personal data.
            </p>
            <Button asChild variant="destructive">
              <Link href="/account-deletion">Delete account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
