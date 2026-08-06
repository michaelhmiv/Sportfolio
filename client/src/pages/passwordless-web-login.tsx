import { useMemo, useState } from "react";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      setError("Please enter a valid email address.");
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
    <div
      className="terminal-page flex min-h-screen items-center justify-center p-4"
      data-testid="passwordless-login-page"
    >
      <Card variant="terminal" className="terminal-shell w-full max-w-md">
        <CardHeader className="space-y-3 border-b border-border pb-4 text-left">
          <div className="terminal-strip">Secure Account Access</div>
          <CardTitle className="terminal-heading text-2xl">Sign in to Sportfolio</CardTitle>
          <CardDescription className="terminal-subtle">
            Enter your email and we will send a secure, single-use sign-in link. No password
            required.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {status === "sent" ? (
            <div className="space-y-4" role="status" aria-live="polite">
              <div className="flex items-start gap-3 rounded-compact border border-primary/25 bg-primary/5 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="terminal-label text-primary">Check your email</p>
                  <p className="terminal-subtle mt-1">
                    If the address can receive a Sportfolio sign-in link, it will arrive shortly.
                    The link expires in five minutes.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="terminalOutline"
                className="w-full"
                onClick={() => setStatus("idle")}
              >
                Use another email
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="passwordless-email" className="terminal-label">
                  Email
                </Label>
                <Input
                  id="passwordless-email"
                  type="email"
                  variant="terminal"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  data-testid="input-passwordless-email"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="terminal"
                className="w-full"
                disabled={status === "submitting"}
                data-testid="button-passwordless-submit"
              >
                {status === "submitting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Email me a sign-in link
                  </>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Single-use link · 5-minute expiry · Secure HttpOnly session
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
