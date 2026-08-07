import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { SurfaceLayout } from "@/components/surface-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { betterAuthClient } from "@/lib/better-auth-client";

type Consent = {
  id: string;
  clientId: string;
  scopes: string[];
  createdAt?: string | Date | null;
};

export default function ConnectedAppsPage() {
  const [grants, setGrants] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: grantsError } = await betterAuthClient.oauth2.getConsents();
    if (grantsError) {
      if (grantsError.status === 401) {
        window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setError(grantsError.message || "Unable to load connected applications.");
    } else {
      setGrants((data ?? []) as Consent[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(grant: Consent) {
    setRevoking(grant.id);
    setError(null);
    const { error: revokeError } = await betterAuthClient.oauth2.deleteConsent({ id: grant.id });
    if (revokeError) {
      setError(revokeError.message || "Unable to revoke this connection.");
    } else {
      setGrants((current) => current.filter((item) => item.id !== grant.id));
    }
    setRevoking(null);
  }

  return (
    <SurfaceLayout kind="status" showFooter={false}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
          Account security
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-content-strong">
          Connected applications
        </h1>
        <p className="mt-3 leading-7 text-content-muted">
          Review and revoke OAuth applications that can access your Sportfolio account.
        </p>

        {error ? (
          <div
            className="mt-7 rounded-panel border border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-8">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-3 text-content-muted">
              <Loader2 className="h-6 w-6 animate-spin text-brand" /> Loading authorized
              applications…
            </div>
          ) : grants.length === 0 ? (
            <Card variant="empty">
              <CardContent className="px-6 py-14 text-center">
                <ShieldCheck className="mx-auto h-10 w-10 text-brand" />
                <h2 className="mt-4 text-xl font-bold text-content-strong">
                  No connected applications
                </h2>
                <p className="mx-auto mt-2 max-w-md leading-6 text-content-muted">
                  No external OAuth application currently has access to this Sportfolio account.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {grants.map((grant) => (
                <Card key={grant.id} variant="default" className="border-border-strong">
                  <CardContent className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-bold text-content-strong">
                            {grant.clientId}
                          </h2>
                          <Badge variant="outline">OAuth</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {grant.scopes.map((scope) => (
                            <Badge key={scope} variant="secondary">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                        {grant.createdAt ? (
                          <p className="mt-3 text-sm text-content-subtle">
                            Connected {new Date(grant.createdAt).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={revoking === grant.id}
                        onClick={() => void revoke(grant)}
                        className="gap-2 sm:shrink-0"
                      >
                        {revoking === grant.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldOff className="h-4 w-4" />
                        )}
                        Disconnect
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </SurfaceLayout>
  );
}
