import { useEffect } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { StatusSurface } from "@/components/surface-layout";
import { Card, CardContent } from "@/components/ui/card";
import { getSupabase } from "@/lib/supabase";

function normalizePostAuthRedirect(path: string | null): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

export default function AuthCallback() {
  const [, navigate] = useLocation();

  useEffect(() => {
    async function handleCallback() {
      const redirectToError = (error: string, description: string) => {
        const params = new URLSearchParams({ error, description });
        navigate(`/auth/error?${params.toString()}`, { replace: true });
      };

      try {
        const supabase = await getSupabase();
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const queryParams = new URLSearchParams(window.location.search);
        const authCode = queryParams.get("code");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (authCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(authCode);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          const {
            data: { session },
            error,
          } = await supabase.auth.getSession();
          if (error) throw error;
          if (!session) {
            redirectToError("session_lost", "We could not find a login session to complete.");
            return;
          }
        }

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session) {
          redirectToError("login_failed", "We could not establish your login session.");
          return;
        }

        const queryRedirect = normalizePostAuthRedirect(queryParams.get("redirect"));
        const storedRedirect = normalizePostAuthRedirect(
          typeof window !== "undefined"
            ? window.sessionStorage.getItem("auth_post_redirect")
            : null,
        );
        const target = storedRedirect || queryRedirect || "/";

        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem("auth_post_redirect");
        }
        navigate(target, { replace: true });
      } catch (error) {
        console.error("[AUTH_CALLBACK] Error:", error);
        const description =
          error instanceof Error ? error.message : "We could not complete your sign-in.";
        const errorString = String(error);
        const errorCode =
          error && typeof error === "object" && "code" in error
            ? String((error as Record<string, unknown>).code)
            : "";
        const normalizedDescription = description.toLowerCase();

        if (
          errorCode === "pkce_code_verifier_not_found" ||
          errorString.includes("code verifier") ||
          normalizedDescription.includes("code verifier") ||
          normalizedDescription.includes("both auth code and code verifier should be non-empty")
        ) {
          redirectToError("link_expired", description);
          return;
        }

        if (
          errorCode === "invalid_grant" ||
          errorString.includes("invalid_grant") ||
          normalizedDescription.includes("already used") ||
          normalizedDescription.includes("already been used") ||
          normalizedDescription.includes("authorization code not found") ||
          normalizedDescription.includes("not found")
        ) {
          redirectToError("link_expired", description);
          return;
        }

        redirectToError("callback_failed", description);
      }
    }

    void handleCallback();
  }, [navigate]);

  return (
    <StatusSurface>
      <Card
        variant="default"
        className="border-border-strong shadow-medium"
        data-testid="auth-callback"
      >
        <CardContent className="flex flex-col items-center px-6 py-10 text-center sm:px-10">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-circle bg-brand-subtle text-brand">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
            <Loader2 className="absolute h-16 w-16 animate-spin text-brand/40" aria-hidden="true" />
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-content-strong">
            Completing your sign-in
          </h1>
          <p className="mt-3 max-w-sm leading-6 text-content-muted">
            Sportfolio is verifying the secure response and restoring the page you requested.
          </p>
        </CardContent>
      </Card>
    </StatusSurface>
  );
}
