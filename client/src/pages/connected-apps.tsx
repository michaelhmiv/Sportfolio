import { useEffect, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { SurfaceLayout } from "@/components/surface-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSupabase } from "@/lib/supabase";

type OAuthGrant = {
  id?: string;
  client_id?: string;
  client?: { name?: string; client_name?: string; client_uri?: string };
  scopes?: string;
  scope?: string;
  granted_at?: string;
};

type OAuthGrantApi = {
  getUserGrants: () => Promise<{ data: OAuthGrant[] | null; error: { message: string } | null }>;
  revokeGrant: (grantId: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function getOAuthApi(auth: unknown): OAuthGrantApi | null {
  return (auth as { oauth?: OAuthGrantApi }).oauth ?? null;
}

export default function ConnectedAppsPage() {
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [selectedGrant, setSelectedGrant] = useState<OAuthGrant | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const supabase = await getSupabase();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const oauth = getOAuthApi(supabase.auth);
      if (!oauth) throw new Error("Connected-app management is unavailable in this client build.");
      const { data, error: grantsError } = await oauth.getUserGrants();
      if (grantsError) throw new Error(grantsError.message);
      setGrants(data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load connected applications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(grant: OAuthGrant) {
    const grantId = grant.id;
    if (!grantId) return;
    setRevoking(grantId);
    setError(null);
    try {
      const supabase = await getSupabase();
      const oauth = getOAuthApi(supabase.auth);
      if (!oauth) throw new Error("Connected-app management is unavailable.");
      const { error: revokeError } = await oauth.revokeGrant(grantId);
      if (revokeError) throw new Error(revokeError.message);
      setGrants((current) => current.filter((item) => item.id !== grantId));
      setSelectedGrant(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke this connection.");
    } finally {
      setRevoking(null);
    }
  }

  const selectedName =
    selectedGrant?.client?.name || selectedGrant?.client?.client_name || "this application";

  return (
    <SurfaceLayout kind="status" showFooter={false}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
            Account security
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-content-strong">
            Connected applications
          </h1>
          <p className="mt-3 leading-7 text-content-muted">
            Review and revoke OAuth applications that can access your Sportfolio account.
          </p>
        </div>

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
              <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
              Loading authorized applications…
            </div>
          ) : grants.length === 0 ? (
            <Card variant="empty">
              <CardContent className="px-6 py-14 text-center">
                <ShieldCheck className="mx-auto h-10 w-10 text-brand" aria-hidden="true" />
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
              {grants.map((grant) => {
                const name =
                  grant.client?.name || grant.client?.client_name || "Connected application";
                const scopes = (grant.scopes || grant.scope || "openid")
                  .split(/\s+/)
                  .filter(Boolean);
                return (
                  <Card
                    key={grant.id || grant.client_id}
                    variant="default"
                    className="border-border-strong"
                  >
                    <CardContent className="p-5 sm:p-6">
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-bold text-content-strong">{name}</h2>
                            <Badge variant="outline">OAuth</Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {scopes.map((scope) => (
                              <Badge key={scope} variant="secondary">
                                {scope}
                              </Badge>
                            ))}
                          </div>
                          {grant.granted_at ? (
                            <p className="mt-3 text-sm text-content-subtle">
                              Connected {new Date(grant.granted_at).toLocaleString()}
                            </p>
                          ) : null}
                          {grant.client?.client_uri ? (
                            <a
                              href={grant.client.client_uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
                            >
                              Application website{" "}
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={!grant.id || revoking === grant.id}
                          onClick={() => setSelectedGrant(grant)}
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
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={selectedGrant !== null}
        onOpenChange={(open) => !open && setSelectedGrant(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {selectedName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This revokes refresh access and prevents new Sportfolio requests through the
              application. Existing short-lived access may remain valid until it expires.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking !== null}>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!selectedGrant?.id || revoking !== null}
              onClick={(event) => {
                event.preventDefault();
                if (selectedGrant) void revoke(selectedGrant);
              }}
            >
              {revoking ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldOff className="mr-2 h-4 w-4" />
              )}
              Disconnect application
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SurfaceLayout>
  );
}
