import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  getAuthorizationDetails: (
    authorizationId: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (
    authorizationId: string,
  ) => Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>;
  denyAuthorization: (
    authorizationId: string,
  ) => Promise<{ data: { redirect_url: string } | null; error: { message: string } | null }>;
};

function getOAuthApi(auth: unknown): OAuthApi | null {
  return (auth as { oauth?: OAuthApi }).oauth ?? null;
}

function safeOrigin(value?: string) {
  if (!value) return "Unknown destination";
  try {
    return new URL(value).origin;
  } catch {
    return "Invalid destination";
  }
}

function scopeLabel(scope: string) {
  const labels: Record<string, string> = {
    openid: "Connect to your Sportfolio account",
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
        if (!oauth) throw new Error("OAuth authorization is not available in this client build.");

        const { data, error: detailsError } = await oauth.getAuthorizationDetails(authorizationId);
        if (detailsError || !data)
          throw new Error(
            detailsError?.message || "The authorization request is invalid or expired.",
          );
        if (data.redirect_url && !data.authorization_id) {
          window.location.replace(data.redirect_url);
          return;
        }
        if (!cancelled) setDetails(data);
      } catch (cause) {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Unable to load this authorization request.",
          );
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
        throw new Error(
          result.error?.message || "The authorization decision could not be completed.",
        );
      }
      window.location.assign(result.data.redirect_url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to complete the authorization request.",
      );
      setSubmitting(null);
    }
  }

  const scopes = (details?.scope || "openid")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const clientName = details?.client?.name || details?.client?.client_name || "ChatGPT or Codex";

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
              ) : error && !details ? (
                <div
                  className="rounded-panel border border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              ) : details ? (
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
                    <ul className="mt-3 space-y-3 text-sm leading-6 text-content-muted">
                      <li>
                        Read supported account information such as virtual holdings, balance,
                        trades, scouts, boosts, watchlists, collections, milestones, schedules,
                        liquidity, news, and profile data.
                      </li>
                      <li>
                        Perform supported account and gameplay actions you explicitly request,
                        including staged virtual trades, scouting, share stacking, boosts, community
                        boosts, and liquidity changes.
                      </li>
                      <li>
                        Use previews and explicit confirmation before finalizing staged gameplay
                        actions.
                      </li>
                    </ul>
                  </section>

                  <div className="flex items-start gap-2 text-xs leading-5 text-content-subtle">
                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      After approval, you will return to {safeOrigin(details.redirect_uri)}.
                    </span>
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
                      onClick={() => void decide("deny")}
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
                      onClick={() => void decide("approve")}
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
