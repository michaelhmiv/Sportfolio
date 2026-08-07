import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock, Home, RefreshCw, Smartphone } from "lucide-react";
import { useLocation } from "wouter";
import { StatusSurface } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ErrorCopy = {
  title: string;
  message: string;
  suggestion: string;
  canAutoRetry: boolean;
  isMobileIssue: boolean;
};

function getErrorCopy(error: string, description: string, isMobile: boolean): ErrorCopy {
  switch (error) {
    case "link_expired":
      return {
        title: "This sign-in link has expired",
        message: "The link has already been used or is no longer valid.",
        suggestion: "Request a fresh sign-in link and use the newest email you receive.",
        canAutoRetry: false,
        isMobileIssue: false,
      };
    case "access_denied":
      return {
        title: "Access was not approved",
        message: "The authentication request was denied.",
        suggestion: "Try again and approve the requested account access when prompted.",
        canAutoRetry: false,
        isMobileIssue: false,
      };
    case "session_lost":
      return {
        title: "Your sign-in session was interrupted",
        message: "Sportfolio could not recover the session created during authentication.",
        suggestion: isMobile
          ? "Open Sportfolio directly in Chrome or Safari rather than an in-app browser, then try again."
          : "Confirm cookies are enabled, then start a new sign-in request.",
        canAutoRetry: true,
        isMobileIssue: true,
      };
    case "redirect_uri_mismatch":
      return {
        title: "Authentication configuration error",
        message: "The return destination did not match the approved configuration.",
        suggestion: "Contact Sportfolio support and include the error code shown below.",
        canAutoRetry: false,
        isMobileIssue: false,
      };
    case "server_error":
      return {
        title: "Authentication service unavailable",
        message: "Sportfolio could not complete the request because of a temporary service issue.",
        suggestion: "Retry in a moment. Contact support if the issue continues.",
        canAutoRetry: true,
        isMobileIssue: false,
      };
    default:
      return {
        title: "Sign-in could not be completed",
        message: description,
        suggestion:
          "Start a new sign-in request. If the problem continues, try a different browser or clear Sportfolio cookies.",
        canAutoRetry: true,
        isMobileIssue: isMobile && error === "auth_failed",
      };
  }
}

export default function AuthError() {
  const [, setLocation] = useLocation();
  const [countdown, setCountdown] = useState(0);
  const [autoRetryCancelled, setAutoRetryCancelled] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error") || "unknown_error";
  const description = params.get("description") || "An unexpected authentication error occurred.";
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const copy = useMemo(
    () => getErrorCopy(error, description, isMobile),
    [description, error, isMobile],
  );
  const hasAutoRetried =
    typeof window !== "undefined" && sessionStorage.getItem("auth_auto_retry_attempted") === "true";

  useEffect(() => {
    if (!copy.canAutoRetry || hasAutoRetried || autoRetryCancelled) return;

    setCountdown(3);
    const interval = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          sessionStorage.setItem("auth_auto_retry_attempted", "true");
          window.location.href = "/login";
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [autoRetryCancelled, copy.canAutoRetry, hasAutoRetried]);

  const resetRetryFlag = () => sessionStorage.removeItem("auth_auto_retry_attempted");

  return (
    <StatusSurface width="max-w-xl">
      <Card variant="default" className="border-border-strong shadow-medium">
        <CardContent className="p-6 sm:p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-circle bg-destructive-subtle text-destructive">
            <AlertCircle className="h-7 w-7" aria-hidden="true" />
          </div>

          <h1
            className="mt-5 text-2xl font-bold tracking-tight text-content-strong"
            data-testid="text-error-title"
          >
            {copy.title}
          </h1>
          <p className="mt-3 leading-6 text-content-muted" data-testid="text-error-message">
            {copy.message}
          </p>

          <div className="mt-6 rounded-panel border border-border-subtle bg-surface-raised p-4">
            <p className="font-semibold text-content">Recommended next step</p>
            <p
              className="mt-2 text-sm leading-6 text-content-muted"
              data-testid="text-error-suggestion"
            >
              {copy.suggestion}
            </p>
          </div>

          {countdown > 0 ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-panel border border-brand/25 bg-brand-subtle p-4 text-sm text-content">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-brand" aria-hidden="true" />
                Retrying in {countdown} second{countdown === 1 ? "" : "s"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAutoRetryCancelled(true);
                  setCountdown(0);
                  sessionStorage.setItem("auth_auto_retry_attempted", "true");
                }}
                data-testid="button-cancel-retry"
              >
                Cancel
              </Button>
            </div>
          ) : null}

          {isMobile && copy.isMobileIssue ? (
            <div className="mt-4 flex gap-3 rounded-panel border border-status-warning/30 bg-status-warning-subtle p-4 text-sm">
              <Smartphone
                className="mt-0.5 h-5 w-5 shrink-0 text-status-warning"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold text-content">Mobile browser guidance</p>
                <p className="mt-1 leading-6 text-content-muted">
                  Use Chrome on Android or Safari on iPhone directly. In-app browsers opened from
                  social media or messaging apps can interrupt secure session cookies.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 text-xs text-content-subtle">
            Error code:{" "}
            <code
              className="rounded-control bg-surface-raised px-2 py-1 font-mono"
              data-testid="text-error-code"
            >
              {error}
            </code>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Button
              onClick={() => {
                resetRetryFlag();
                window.location.href = "/login";
              }}
              disabled={countdown > 0}
              className="gap-2"
              data-testid="button-retry-login"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                resetRetryFlag();
                setLocation("/");
              }}
              className="gap-2"
              data-testid="button-go-home"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              Return home
            </Button>
          </div>
        </CardContent>
      </Card>
    </StatusSurface>
  );
}
