import { useEffect, useState } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    const name = grant.client?.name || grant.client?.client_name || "this application";
    if (!window.confirm(`Disconnect ${name}? Its refresh tokens and active OAuth sessions will be revoked.`)) return;

    setRevoking(grantId);
    setError(null);
    try {
      const supabase = await getSupabase();
      const oauth = getOAuthApi(supabase.auth);
      if (!oauth) throw new Error("Connected-app management is unavailable.");
      const { error: revokeError } = await oauth.revokeGrant(grantId);
      if (revokeError) throw new Error(revokeError.message);
      setGrants((current) => current.filter((item) => item.id !== grantId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke this connection.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <main className="terminal-page min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Card variant="terminal" className="terminal-shell">
          <CardHeader className="border-b border-border">
            <CardTitle>Connected applications</CardTitle>
            <CardDescription>Review and revoke applications authorized to access your Sportfolio account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>
            ) : error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div>
            ) : grants.length === 0 ? (
              <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">No applications currently have OAuth access to your account.</div>
            ) : (
              grants.map((grant) => {
                const name = grant.client?.name || grant.client?.client_name || "Connected application";
                const scopes = (grant.scopes || grant.scope || "openid").split(/\s+/).filter(Boolean);
                return (
                  <section key={grant.id || grant.client_id} className="rounded-md border border-border p-4">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                      <div>
                        <h2 className="font-semibold">{name}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">Permissions: {scopes.join(", ")}</p>
                        {grant.granted_at ? <p className="mt-1 text-xs text-muted-foreground">Connected {new Date(grant.granted_at).toLocaleString()}</p> : null}
                      </div>
                      <Button type="button" variant="destructive" disabled={!grant.id || revoking === grant.id} onClick={() => void revoke(grant)}>
                        {revoking === grant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ShieldOff className="mr-2 h-4 w-4" />Disconnect</>}
                      </Button>
                    </div>
                  </section>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
