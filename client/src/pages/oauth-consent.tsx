import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/lib/supabase";

type OAuthClient = {
  name?: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
};

type AuthorizationDetails = {
  authorization_id?: string;
  client?: OAuthClient;
  redirect_uri?: string;
  scope?: string;
  redirect_url?: string;
};

type OAuthApi = {
  getAuthorizationDetails: (authorizationId: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (authorizationId: string) => Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>;
  denyAuthorization: (authorizationId: string) => Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>;
};

function getOAuthApi(auth: unknown): OAuthApi | null {
  const candidate = (auth as { oauth?: OAuthApi }).oauth;
  return candidate ?? null;
}

function safeOrigin(value?: string): string {
  if (!value) return "Unknown destination";
  try {
    return new URL(value).origin;
  } catch {
    return "Invalid destination";
  }
}

function scopeLabel(scope: string): string {
  const labels: Record<string, string> = {
    openid: "Verify your Sportfolio identity",
    email: "Read your account email",
    profile: "Read basic profile information",
    phone: "Read your account phone number",
  };
  return labels[scope] ?? scope;
}

export default function OAuthConsentPage() {
  const authorizationId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("authorization_id");
  }, []);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!authorizationId) {
        setError("This authorization request is missing its identifier.");
        setLoading(false);
        return;
      }

      try {
        const supabase = await getSupabase();
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          const returnPath = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/login?redirect=${encodeURIComponent(returnPath)}`);
          return;
        }

        const oauth = getOAuthApi(supabase.auth);
        if (!oauth) {
          throw new Error("OAuth authorization is not available in this client build.");
        }

        const { data, error: detailsError } = await oauth.getAuthorizationDetails(authorizationId);
        if (detailsError || !data) {
          throw new Error(detailsError?.message || "The authorization request is invalid or expired.");
        }

        if (data.redirect_url && !data.authorization_id) {
          window.location.replace(data.redirect_url);
          return;
        }

        if (!cancelled) setDetails(data);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load this authorization request.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  async function decide(decision: "approve" | "deny") {
    if (!authorizationId) return;
    setSubmitting(decision);
    setError(null);

    try {
      const supabase = await getSupabase();
      const oauth = getOAuthApi(supabase.auth);
      if (!oauth) throw new Error("OAuth authorization is unavailable.");

      const result =
        decision === "approve"
          ? await oauth.approveAuthorization(authorizationId)
          : await oauth.denyAuthorization(authorizationId);

      if (result.error || !result.data?.redirect_url) {
        throw new Error(result.error?.message || "The authorization decision could not be completed.");
      }

      window.location.assign(result.data.redirect_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete the authorization request.");
      setSubmitting(null);
    }
  }

  const scopes = (details?.scope || "openid")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const clientName = details?.client?.name || details?.client?.client_name || "ChatGPT or Codex";

  return (
    <main className="terminal-page flex min-h-screen items-center justify-center p-4">
      <Card variant="terminal" className="terminal-shell w-full max-w-xl">
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-primary/30 bg-primary/10 p-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>Connect {clientName}</CardTitle>
              <CardDescription>Review the access request before connecting your Sportfolio account.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center" data-testid="oauth-consent-loading">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          ) : error && !details ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
              {error}
            </div>
          ) : details ? (
            <>
              <section className="space-y-2">
                <p className="terminal-label">Requested access</p>
                <ul className="space-y-2">
                  {scopes.map((scope) => (
                    <li key={scope} className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                      {scopeLabel(scope)}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-md border border-border p-4 text-sm">
                <p className="terminal-label">What this connection can do</p>
                <p className="mt-2 text-muted-foreground">
                  Read the Sportfolio information exposed by the marketplace plugin, such as your virtual portfolio, player performance, boosts, collections, and game insights.
                </p>
                <p className="mt-2 text-muted-foreground">
                  It cannot reveal passwords or API keys, manage SMS verification, purchase premium access, or execute virtual trades in plugin version 1.
                </p>
              </section>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
                Return destination: {safeOrigin(details.redirect_uri)}
              </div>

              {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                  {error}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="terminalOutline"
                  disabled={submitting !== null}
                  onClick={() => void decide("deny")}
                  data-testid="oauth-consent-deny"
                >
                  {submitting === "deny" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deny"}
                </Button>
                <Button
                  type="button"
                  variant="terminal"
                  disabled={submitting !== null}
                  onClick={() => void decide("approve")}
                  data-testid="oauth-consent-approve"
                >
                  {submitting === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Allow access"}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
