import { ExternalLink, Link2, Settings, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { CliAccessCard } from "@/components/cli-access-card";
import { MobilePushCard } from "@/components/mobile-push-card";
import { NotificationSettingsCard } from "@/components/notification-settings-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AccountSettings() {
  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="rounded-panel border border-border-subtle bg-surface p-5 shadow-low sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-subtle text-brand">
              <Settings className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-content-subtle">Account controls</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-content-strong">Settings</h1>
              <p className="mt-2 text-sm leading-6 text-content-muted">Manage notifications, device access, connected applications, and account lifecycle controls.</p>
            </div>
          </div>
        </header>

        <div className="grid gap-5">
          <NotificationSettingsCard />
          <MobilePushCard />
          <CliAccessCard />

          <Card variant="default">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                  <div>
                    <h2 className="font-bold text-content-strong">Connected applications</h2>
                    <p className="mt-1 text-sm leading-6 text-content-muted">Review or revoke ChatGPT, Codex, and other OAuth connections authorized for this account.</p>
                  </div>
                </div>
                <Button asChild variant="outline" className="gap-2 sm:shrink-0">
                  <a href="/oauth/connected-apps/">Manage access<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card variant="default" className="border-destructive/25">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                  <div>
                    <h2 className="font-bold text-content-strong">Delete account</h2>
                    <p className="mt-1 text-sm leading-6 text-content-muted">Request permanent removal of account access and associated personal data, subject to disclosed retention requirements.</p>
                  </div>
                </div>
                <Button asChild variant="destructive" className="sm:shrink-0">
                  <Link href="/account-deletion">Review deletion</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
