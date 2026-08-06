import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { StatusSurface } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
          title: "This sign-in link has expired",
          detail: "Magic links expire after five minutes and can only be used once.",
        }
      : state === "invalid"
        ? {
            title: "Sign-in could not be completed",
            detail: "The link is invalid or incomplete. Request a new one and try again.",
          }
        : state === "complete"
          ? {
              title: "You are signed in",
              detail: "Your secure session is ready. Returning you to Sportfolio.",
            }
          : {
              title: "Verifying your secure link",
              detail: "This should only take a moment.",
            };

  const isError = state === "invalid" || state === "expired";

  return (
    <StatusSurface>
      <Card variant="default" className="border-border-strong shadow-medium">
        <CardContent className="px-6 py-9 text-center sm:px-10">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-circle ${
              isError
                ? "bg-destructive-subtle text-destructive"
                : "bg-brand-subtle text-brand"
            }`}
          >
            {state === "working" ? (
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
            ) : state === "complete" ? (
              <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-7 w-7" aria-hidden="true" />
            )}
          </div>

          <h1 className="mt-5 text-2xl font-bold tracking-tight text-content-strong">{copy.title}</h1>
          <p className="mx-auto mt-3 max-w-sm leading-6 text-content-muted">{copy.detail}</p>

          {isError ? (
            <Button className="mt-6 w-full" onClick={() => navigate("/login", { replace: true })}>
              Request a new link
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </StatusSurface>
  );
}
