import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Mail, ShieldCheck } from "lucide-react";
import { AuthSurface } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidEmail, normalizeEmail } from "@/lib/auth-input";
import { normalizePasswordlessReturnTo, requestPasswordlessEmail } from "@/lib/passwordless-auth";

export default function PasswordlessWebLogin() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const normalizedEmail = useMemo(() => normalizeEmail(email), [email]);
  const returnTo = useMemo(() => {
    if (typeof window === "undefined") return "/";
    return normalizePasswordlessReturnTo(
      new URLSearchParams(window.location.search).get("redirect"),
    );
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setError(null);

    try {
      await requestPasswordlessEmail(normalizedEmail, returnTo);
      setStatus("sent");
    } catch (requestError) {
      setStatus("error");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Authentication is temporarily unavailable.",
      );
    }
  };

  return (
    <AuthSurface
      title="Sign in to Sportfolio"
      description="Use a secure, single-use link to continue. No password is required."
    >
      <Card variant="default" className="overflow-hidden border-border-strong shadow-medium">
        <CardContent className="p-6 sm:p-7">
          {status === "sent" ? (
            <div className="space-y-5" role="status" aria-live="polite">
              <div className="flex h-12 w-12 items-center justify-center rounded-circle bg-brand-subtle text-brand">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-content-strong">Check your email</h2>
                <p className="mt-2 leading-6 text-content-muted">
                  A sign-in link was requested for <span className="font-medium text-content">{normalizedEmail}</span>. It expires after five minutes and can only be used once.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setStatus("idle");
                  setError(null);
                }}
              >
                Use another email
              </Button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="passwordless-email">Email address</Label>
                <Input
                  id="passwordless-email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-11"
                  data-testid="input-passwordless-email"
                />
              </div>

              {error ? (
                <div className="rounded-panel border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive" role="alert">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                className="h-11 w-full gap-2"
                disabled={status === "submitting"}
                data-testid="button-passwordless-submit"
              >
                {status === "submitting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="h-4 w-4" aria-hidden="true" />
                )}
                {status === "submitting" ? "Sending secure link" : "Email me a sign-in link"}
              </Button>

              <div className="flex items-start gap-2 border-t border-border-subtle pt-4 text-xs leading-5 text-content-subtle">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                <p>The link creates a secure HttpOnly session and returns you to the page you were viewing.</p>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthSurface>
  );
}
