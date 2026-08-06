import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { broadcastWebAuthChange, normalizePasswordlessReturnTo } from "@/lib/passwordless-auth";

export default function AuthComplete() {
  const [, navigate] = useLocation();
  const [state, setState] = useState<"working" | "complete" | "invalid" | "expired">("working");

  useEffect(() => {
    const continuation = new URLSearchParams(window.location.search).get("continuation");
    if (!continuation) {
      setState("invalid");
      return;
    }
    void fetch(`/api/auth/web/complete?continuation=${encodeURIComponent(continuation)}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.completed) {
          setState(response.status === 410 ? "expired" : "invalid");
          return;
        }
        setState("complete");
        broadcastWebAuthChange("signed-in");
        window.setTimeout(
          () => navigate(normalizePasswordlessReturnTo(payload.destination), { replace: true }),
          250,
        );
      })
      .catch(() => setState("invalid"));
  }, [navigate]);

  const copy =
    state === "expired"
      ? {
          title: "This link is no longer valid",
          detail: "Magic links expire after five minutes and can only be used once.",
        }
      : state === "invalid"
        ? { title: "Sign-in could not be completed", detail: "Request a new link and try again." }
        : state === "complete"
          ? { title: "Signed in", detail: "Returning you to Sportfolio." }
          : { title: "Completing sign-in", detail: "Verifying your secure session." };

  return (
    <div className="terminal-page flex min-h-screen items-center justify-center p-4">
      <Card variant="terminal" className="terminal-shell w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {state === "working" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : state === "complete" ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            {copy.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="terminal-subtle">{copy.detail}</p>
          {(state === "invalid" || state === "expired") && (
            <Button
              variant="terminal"
              className="w-full"
              onClick={() => navigate("/login", { replace: true })}
            >
              Request a new link
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
