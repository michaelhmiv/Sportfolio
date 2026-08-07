import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import PasswordlessWebLogin from "@/pages/passwordless-web-login";

function normalizePostAuthRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}

export default function Login() {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const postAuthRedirect = useMemo(() => {
    if (typeof window === "undefined") return "/";
    return normalizePostAuthRedirect(new URLSearchParams(window.location.search).get("redirect"));
  }, []);

  useEffect(() => {
    if (isAuthenticated) navigate(postAuthRedirect, { replace: true });
  }, [isAuthenticated, navigate, postAuthRedirect]);

  if (isLoading || isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center" data-testid="login-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <PasswordlessWebLogin />;
}
