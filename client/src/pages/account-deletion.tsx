import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react";
import { Link } from "wouter";
import { PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { SPORTFOLIO_SUPPORT_EMAIL } from "@/lib/community-links";
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";

const MAILTO_HREF = `mailto:${SPORTFOLIO_SUPPORT_EMAIL}?subject=Sportfolio%20Account%20Deletion%20Help`;
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
  "Saved preferences, watchlists, schedules, and account-specific settings",
  "Scouting, collection, and other active gameplay configuration tied to the account",
  "Connected-application authorizations and account-linked continuation records",
] as const;

const retainedData = [
  "Trade, portfolio, reward, and action ledger records needed for fraud prevention, dispute handling, security review, or legal compliance",
  "Operational logs and backups retained for a limited period while deletion is processed",
] as const;

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

  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<AccountDeletionStatusResponse>({
    queryKey: ["/api/account/deletion/status"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const response = await authenticatedFetch("/api/account/deletion/status", {
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (!response.ok) throw new Error("Could not load account deletion status.");
      return (await response.json()) as AccountDeletionStatusResponse;
    },
  });

  const confirmationText = status?.confirmationText || FALLBACK_CONFIRMATION_TEXT;
  const requestStatus = status?.request?.status || status?.status || "none";

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
        title: "Deletion request submitted",
        description: "You can cancel the request while it remains pending.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not submit request",
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
      toast({ title: "Deletion request cancelled", description: "Your account remains active." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not cancel request",
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
    switch (requestStatus) {
      case "pending":
        return "text-status-warning";
      case "processing":
        return "text-status-info";
      case "completed":
        return "text-market-positive";
      case "failed":
        return "text-market-negative";
      default:
        return "text-content-muted";
    }
  }, [requestStatus]);

  return (
    <SurfaceLayout kind="legal">
      <PageHero
        eyebrow="Account control"
        title="Delete your Sportfolio account"
        description="Submit, review, or cancel an account deletion request directly. This workflow is permanent once processing completes."
        icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
        compact
      />

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 lg:py-14">
        <main>
          <Card variant="default" className="border-border-strong shadow-low">
            <CardContent className="p-6 sm:p-8">
              {!isAuthenticated ? (
                <div className="text-center">
                  <ShieldCheck className="mx-auto h-10 w-10 text-brand" aria-hidden="true" />
                  <h2 className="mt-4 text-xl font-bold text-content-strong">
                    Sign in to verify the account
                  </h2>
                  <p className="mx-auto mt-2 max-w-md leading-6 text-content-muted">
                    Deletion requests must be initiated from the account being removed.
                  </p>
                  <Button asChild className="mt-6" data-testid="button-signin-delete-account">
                    <Link href="/login?redirect=/account-deletion">Sign in to continue</Link>
                  </Button>
                </div>
              ) : statusLoading ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-content-muted">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  Loading deletion status…
                </div>
              ) : status?.hasRequest && status.request ? (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-content-subtle">
                        Current request
                      </p>
                      <h2 className={`mt-2 text-2xl font-bold capitalize ${statusTone}`}>
                        {status.request.status}
                      </h2>
                    </div>
                    {status.request.status === "completed" ? (
                      <CheckCircle2 className="h-7 w-7 text-market-positive" aria-hidden="true" />
                    ) : null}
                  </div>

                  <dl className="mt-7 divide-y divide-border-subtle rounded-panel border border-border-subtle bg-surface-raised px-4">
                    <div className="grid gap-1 py-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                      <dt className="text-sm font-medium text-content">Requested</dt>
                      <dd className="text-sm text-content-muted">
                        {formatTimestamp(status.request.requestedAt) || "Unavailable"}
                        {relativeTimestamp(status.request.requestedAt)
                          ? ` (${relativeTimestamp(status.request.requestedAt)})`
                          : ""}
                      </dd>
                    </div>
                    <div className="grid gap-1 py-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                      <dt className="text-sm font-medium text-content">
                        Effective processing time
                      </dt>
                      <dd className="text-sm text-content-muted">
                        {formatTimestamp(status.request.effectiveAt) || "Unavailable"}
                      </dd>
                    </div>
                    {status.request.processedAt ? (
                      <div className="grid gap-1 py-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                        <dt className="text-sm font-medium text-content">Processed</dt>
                        <dd className="text-sm text-content-muted">
                          {formatTimestamp(status.request.processedAt)}
                        </dd>
                      </div>
                    ) : null}
                    {status.request.retainedRecordsNote ? (
                      <div className="py-4 text-sm leading-6 text-content-muted">
                        {status.request.retainedRecordsNote}
                      </div>
                    ) : null}
                  </dl>

                  {status.canCancel ? (
                    <Button
                      variant="outline"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending}
                      className="mt-6 gap-2"
                      data-testid="button-cancel-account-deletion"
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Undo2 className="h-4 w-4" />
                      )}
                      Cancel deletion request
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div>
                  <div className="flex gap-3 rounded-panel border border-destructive/25 bg-destructive-subtle p-4">
                    <AlertTriangle
                      className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                    <div>
                      <h2 className="font-bold text-content-strong">
                        This action becomes permanent.
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-content-muted">
                        Type <strong className="text-content">{confirmationText}</strong> exactly to
                        enable the request button.
                      </p>
                    </div>
                  </div>

                  <div className="mt-7 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="delete-confirmation">Confirmation</Label>
                      <Input
                        id="delete-confirmation"
                        value={confirmationTextInput}
                        onChange={(event) => setConfirmationTextInput(event.target.value)}
                        placeholder={confirmationText}
                        autoCapitalize="characters"
                        data-testid="input-delete-confirmation"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="delete-reason">Reason (optional)</Label>
                      <Input
                        id="delete-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Privacy, duplicate account, or another reason"
                        maxLength={200}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="delete-details">Additional details (optional)</Label>
                      <Textarea
                        id="delete-details"
                        value={details}
                        onChange={(event) => setDetails(event.target.value)}
                        maxLength={1000}
                        placeholder="Include context needed for safe processing."
                        className="min-h-28"
                      />
                    </div>
                  </div>

                  <Button
                    variant="destructive"
                    className="mt-7 gap-2"
                    disabled={!canSubmitRequest}
                    onClick={() => requestMutation.mutate()}
                    data-testid="button-request-account-deletion"
                  >
                    {requestMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Submit deletion request
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </main>

        <aside className="space-y-5">
          <section className="rounded-panel border border-border-subtle bg-surface p-5">
            <h2 className="font-bold text-content-strong">Removed from active systems</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-content-muted">
              {deletedData.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-panel border border-status-warning/30 bg-status-warning-subtle p-5">
            <h2 className="font-bold text-content-strong">Records that may be retained</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-content-muted">
              {retainedData.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <Button asChild variant="outline" className="w-full gap-2">
            <a href={MAILTO_HREF}>
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email support
            </a>
          </Button>
        </aside>
      </div>
    </SurfaceLayout>
  );
}
