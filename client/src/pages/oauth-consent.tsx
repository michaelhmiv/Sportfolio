import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { betterAuthClient } from "@/lib/better-auth-client";
import { resolveOAuthConsentRequest } from "@/lib/oauth-flow";

type OAuthClient = {
  name?: string | null;
  client_name?: string | null;
  uri?: string | null;
  client_uri?: string | null;
  icon?: string | null;
  logo_uri?: string | null;
  redirectUris?: string[] | null;
  redirect_uris?: string[] | null;
};

function safeOrigin(value?: string | null) {
  if (!value) return "the requesting application";
  try {
    return new URL(value).origin;
  } catch {
    return "the requesting application";
  }
}

function scopeLabel(scope: string) {
  const labels: Record<string, string> = {
    openid: "Connect to your Sportfolio account",
    email: "Read your account email",
    profile: "Read basic profile information",
    offline_access: "Stay connected until you revoke access",
    "sportfolio.read": "Read supported Sportfolio account and market data",
    "sportfolio.trade": "Preview and execute trades you explicitly request",
    "sportfolio.scout": "Perform scouting actions you explicitly request",
    "sportfolio.manage": "Manage supported account gameplay settings you explicitly request",
  };
  return labels[scope] ?? scope;
}

export default function OAuthConsentPage() {
  const oauthRequest = useMemo(
    () => resolveOAuthConsentRequest(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const clientId = oauthRequest.clientId;
  const requestedScope = oauthRequest.scope;
  const [client, setClient] = useState<OAuthClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!clientId) {
        setError(
          "This authorization request is invalid or expired. Please restart the connection.",
        );
        setLoading(false);
        return;
      }
      const { data, error: clientError } = await betterAuthClient.oauth2.publicClient({
        query: { client_id: clientId },
      });
      if (cancelled) return;
      if (clientError || !data) {
        const returnPath = `${window.location.pathname}${window.location.search}`;
        if (clientError?.status === 401) {
          window.location.replace(`/login?redirect=${encodeURIComponent(returnPath)}`);
          return;
        }
        setError(clientError?.message || "The authorization request is invalid or expired.");
        setLoading(false);
        return;
      }
      setClient(data as OAuthClient);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function decide(accept: boolean) {
    setSubmitting(accept ? "approve" : "deny");
    setError(null);
    const { data, error: consentError } = await betterAuthClient.oauth2.consent({
      accept,
      scope: accept ? requestedScope : undefined,
      ...(oauthRequest.oauthQuery ? { oauth_query: oauthRequest.oauthQuery } : {}),
    });
    if (consentError) {
      setError(consentError.message || "The authorization decision could not be completed.");
      setSubmitting(null);
      return;
    }

    const redirect = data as
      | { redirectURI?: string; redirectUri?: string; redirect_url?: string; url?: string }
      | null
      | undefined;
    const target =
      redirect?.redirectURI || redirect?.redirectUri || redirect?.redirect_url || redirect?.url;
    if (target) window.location.assign(target);
  }

  const scopes = requestedScope
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const clientName = client?.name || client?.client_name || "ChatGPT or Codex";
  const redirectUri = client?.redirectUris?.[0] || client?.redirect_uris?.[0] || null;

  return (
    <SurfaceLayout kind="auth" showFooter={false}>
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-5xl items-center justify-center px-4 py-10 sm:px-6">
        <Card
          variant="default"
          className="w-full max-w-2xl overflow-hidden border-border-strong shadow-medium"
        >
          <CardContent className="p-0">
            <header className="border-b border-border-subtle bg-surface-raised px-6 py-6 sm:px-8">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-panel bg-brand-subtle text-brand">
                  <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
                    Secure account connection
                  </p>
                  <h1 className="mt-2 text-2xl font-bold tracking-tight text-content-strong">
                    Connect {clientName}
                  </h1>
                  <p className="mt-2 leading-6 text-content-muted">
                    Review what the application can access before continuing.
                  </p>
                </div>
              </div>
            </header>

            <div className="p-6 sm:p-8">
              {loading ? (
                <div
                  className="flex min-h-52 flex-col items-center justify-center gap-3 text-content-muted"
                  data-testid="oauth-consent-loading"
                >
                  <Loader2 className="h-7 w-7 animate-spin text-brand" aria-hidden="true" />
                  Loading authorization request…
                </div>
              ) : error && !client ? (
                <div
                  className="rounded-panel border border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              ) : client ? (
                <div className="space-y-6">
                  <section>
                    <h2 className="text-sm font-bold text-content-strong">Requested access</h2>
                    <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-panel border border-border-subtle bg-surface">
                      {scopes.map((scope) => (
                        <li
                          key={scope}
                          className="flex items-center gap-3 px-4 py-3 text-sm text-content-muted"
                        >
                          <LockKeyhole className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                          {scopeLabel(scope)}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="rounded-panel border border-border-subtle bg-surface-raised p-5">
                    <h2 className="font-bold text-content-strong">What the connection can do</h2>
                    <p className="mt-3 text-sm leading-6 text-content-muted">
                      Sportfolio only grants the scopes shown above. Gameplay mutations remain
                      limited to supported actions and explicit requests; OAuth does not grant
                      administrative access.
                    </p>
                  </section>

                  <div className="flex items-start gap-2 text-xs leading-5 text-content-subtle">
                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>After approval, you will return to {safeOrigin(redirectUri)}.</span>
                  </div>

                  {error ? (
                    <div
                      className="rounded-panel border border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive"
                      role="alert"
                    >
                      {error}
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting !== null}
                      onClick={() => void decide(false)}
                      data-testid="oauth-consent-deny"
                    >
                      {submitting === "deny" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Deny"
                      )}
                    </Button>
                    <Button
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => void decide(true)}
                      data-testid="oauth-consent-approve"
                    >
                      {submitting === "approve" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Allow access"
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </SurfaceLayout>
  );
}
