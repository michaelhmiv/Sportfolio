import { useEffect } from "react";
import { useLocation } from "wouter";
import { getSupabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const [, navigate] = useLocation();

  useEffect(() => {
    async function handleCallback() {
      const redirectToError = (error: string, description: string) => {
        const params = new URLSearchParams({
          error,
          description,
        });
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
          if (error) {
            throw error;
          }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            throw error;
          }
        } else {
          const {
            data: { session },
            error,
          } = await supabase.auth.getSession();
          if (error) {
            throw error;
          }
          if (!session) {
            redirectToError("session_lost", "We could not find a login session to complete.");
            return;
          }
        }

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!session) {
          redirectToError("login_failed", "We could not establish your login session.");
          return;
        }

        navigate("/", { replace: true });
      } catch (error) {
        console.error("[AUTH_CALLBACK] Error:", error);
        const description =
          error instanceof Error ? error.message : "We could not complete your sign-in.";
        const normalizedDescription = description.toLowerCase();

        if (
          normalizedDescription.includes("code verifier") ||
          normalizedDescription.includes("both auth code and code verifier should be non-empty")
        ) {
          redirectToError("session_lost", description);
          return;
        }

        redirectToError("callback_failed", description);
      }
    }

    handleCallback();
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen" data-testid="auth-callback">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
