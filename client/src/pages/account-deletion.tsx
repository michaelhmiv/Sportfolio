import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";

const SUPPORT_EMAIL = "sportfolioholdings@gmail.com";
const MAILTO_HREF = `mailto:${SUPPORT_EMAIL}?subject=Sportfolio%20Account%20Deletion%20Help`;
const FALLBACK_CONFIRMATION_TEXT = "DELETE";

interface DeletionRequestView {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled" | string;
  reason?: string | null;
  details?: string | null;
  requestedAt: string;
  effectiveAt: string;
  cancelledAt?: string | null;
  processedAt?: string | null;
  retainedRecordsNote?: string | null;
}

interface AccountDeletionStatusResponse {
  hasRequest: boolean;
  status: "none" | "pending" | "processing" | "completed" | "failed" | "cancelled" | string;
  canCancel: boolean;
  request: DeletionRequestView | null;
  confirmationText?: string;
  supportEmail?: string;
}

const deletedData = [
  "Sportfolio account profile and sign-in access",
  "Linked SMS settings and phone-link configuration",
  "Saved app preferences and scouting configuration tied to the account",
  "In-app agent chat history and related user conversation threads",
];

const retainedData = [
  "Trade, portfolio, and reward ledger records needed for fraud prevention, dispute handling, security review, or legal compliance",
  "Operational logs and backups retained for a limited period while deletion is processed",
];

function formatTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function relativeTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDistanceToNowStrict(parsed, { addSuffix: true });
}

export default function AccountDeletion() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [confirmationTextInput, setConfirmationTextInput] = useState("");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } =
    useQuery<AccountDeletionStatusResponse>({
      queryKey: ["/api/account/deletion/status"],
      enabled: isAuthenticated,
      queryFn: async () => {
        const response = await authenticatedFetch("/api/account/deletion/status", {
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        if (!response.ok) {
          throw new Error("Could not load account deletion status.");
        }
        return (await response.json()) as AccountDeletionStatusResponse;
      },
    });

  const confirmationText = status?.confirmationText || FALLBACK_CONFIRMATION_TEXT;
  const requestInFlightStatus = status?.request?.status || status?.status || "none";

  const requestMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/account/deletion/request", {
        confirmationText: confirmationTextInput,
        reason: reason.trim() || undefined,
        details: details.trim() || undefined,
      });
      return response.json() as Promise<AccountDeletionStatusResponse & { success: boolean }>;
    },
    onSuccess: async () => {
      await refetchStatus();
      setConfirmationTextInput("");
      setReason("");
      setDetails("");
      toast({
        title: "Deletion Request Submitted",
        description:
          "Your deletion request is active. You can cancel it while it remains in pending status.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could Not Submit Request",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/account/deletion/cancel");
      return response.json();
    },
    onSuccess: async () => {
      await refetchStatus();
      toast({
        title: "Deletion Request Cancelled",
        description: "Your account deletion request has been cancelled.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could Not Cancel Request",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const canSubmitRequest =
    confirmationTextInput.trim().toUpperCase() === confirmationText &&
    !requestMutation.isPending &&
    isAuthenticated;

  const statusTone = useMemo(() => {
    switch (requestInFlightStatus) {
      case "pending":
        return "text-amber-400";
      case "processing":
        return "text-blue-400";
      case "completed":
        return "text-green-400";
      case "failed":
        return "text-red-400";
      case "cancelled":
        return "text-muted-foreground";
      default:
        return "text-muted-foreground";
    }
  }, [requestInFlightStatus]);

  return (
    <div className="terminal-page">
      <div className="mx-auto max-w-4xl p-6 md:p-12">
        <div className="terminal-shell mb-8 p-5 md:p-6">
          <div className="terminal-strip">Account Controls</div>
          <h1
            className="terminal-heading mt-4 text-3xl md:text-4xl"
            data-testid="heading-account-deletion"
          >
            Delete Your Sportfolio Account
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            Submit and monitor your account deletion request directly in-app. Email support remains
            available for help, but deletion initiation happens here.
          </p>
        </div>

        <div className="space-y-6">
          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <Trash2 className="h-5 w-5 text-primary" />
                Request Deletion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isAuthenticated ? (
                <div className="terminal-shell space-y-3 p-4">
                  <p className="text-sm text-muted-foreground">
                    Sign in to request account deletion from this page.
                  </p>
                  <Button asChild variant="terminal" data-testid="button-signin-delete-account">
                    <Link href="/login?redirect=/account-deletion">Sign In to Continue</Link>
                  </Button>
                </div>
              ) : statusLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading deletion status...
                </div>
              ) : status?.hasRequest && status.request ? (
                <div className="terminal-shell space-y-4 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="terminal-label">Current Request Status</div>
                      <p className={`text-sm font-semibold uppercase tracking-wide ${statusTone}`}>
                        {status.request.status}
                      </p>
                    </div>
                    {status.request.status === "completed" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-400" />
                    ) : null}
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Requested:{" "}
                      <span className="text-foreground">
                        {formatTimestamp(status.request.requestedAt) || "Unavailable"}
                      </span>
                      {relativeTimestamp(status.request.requestedAt)
                        ? ` (${relativeTimestamp(status.request.requestedAt)})`
                        : ""}
                    </p>
                    <p>
                      Effective processing time:{" "}
                      <span className="text-foreground">
                        {formatTimestamp(status.request.effectiveAt) || "Unavailable"}
                      </span>
                    </p>
                    {status.request.processedAt ? (
                      <p>
                        Processed:{" "}
                        <span className="text-foreground">
                          {formatTimestamp(status.request.processedAt)}
                        </span>
                      </p>
                    ) : null}
                    {status.request.cancelledAt ? (
                      <p>
                        Cancelled:{" "}
                        <span className="text-foreground">
                          {formatTimestamp(status.request.cancelledAt)}
                        </span>
                      </p>
                    ) : null}
                    {status.request.retainedRecordsNote ? (
                      <p>{status.request.retainedRecordsNote}</p>
                    ) : null}
                  </div>
                  {status.canCancel ? (
                    <Button
                      variant="terminalOutline"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending}
                      className="gap-2"
                      data-testid="button-cancel-account-deletion"
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Undo2 className="h-4 w-4" />
                      )}
                      Cancel Deletion Request
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Confirm this action by typing <strong>{confirmationText}</strong>. This request
                    permanently removes account access once processed.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="delete-confirmation" className="terminal-label">
                      Confirmation
                    </Label>
                    <Input
                      id="delete-confirmation"
                      variant="terminal"
                      value={confirmationTextInput}
                      onChange={(event) => setConfirmationTextInput(event.target.value)}
                      placeholder={confirmationText}
                      autoCapitalize="characters"
                      data-testid="input-delete-confirmation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="delete-reason" className="terminal-label">
                      Reason (optional)
                    </Label>
                    <Input
                      id="delete-reason"
                      variant="terminal"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="privacy, duplicate account, other"
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="delete-details" className="terminal-label">
                      Additional details (optional)
                    </Label>
                    <Textarea
                      id="delete-details"
                      value={details}
                      onChange={(event) => setDetails(event.target.value)}
                      maxLength={1000}
                      placeholder="Include any context needed for safe processing."
                      className="min-h-[100px] border-border bg-background text-sm"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Retention disclosure: trade and reward ledger records may be retained for fraud
                    prevention, disputes, security review, and legal compliance.
                  </p>
                  <Button
                    variant="terminal"
                    className="gap-2"
                    disabled={!canSubmitRequest}
                    onClick={() => requestMutation.mutate()}
                    data-testid="button-request-account-deletion"
                  >
                    {requestMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Submit Deletion Request
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="terminalOutline"
                  className="gap-2"
                  onClick={() => window.open(MAILTO_HREF, "_self")}
                >
                  <Mail className="h-4 w-4" />
                  Email Support
                </Button>
                <Button asChild variant="terminalOutline" className="gap-2">
                  <Link href="/contact">
                    <ExternalLink className="h-4 w-4" />
                    Contact Page
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <ShieldCheck className="h-5 w-5 text-primary" />
                What We Delete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                After your request is processed, Sportfolio removes these account-linked records
                from active systems:
              </p>
              <ul className="space-y-2">
                {deletedData.map((item) => (
                  <li key={item} className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <AlertTriangle className="h-5 w-5 text-primary" />
                Data We May Retain Temporarily
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Some records may be retained for up to 90 days after processing, or longer when
                required by law or security obligations.
              </p>
              <ul className="space-y-2">
                {retainedData.map((item) => (
                  <li key={item} className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Need help? Contact{" "}
                <a className="text-primary underline underline-offset-4" href={MAILTO_HREF}>
                  {status?.supportEmail || SUPPORT_EMAIL}
                </a>
                .
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="terminal-subtle mt-8">Last updated: May 28, 2026</p>
      </div>
    </div>
  );
}
