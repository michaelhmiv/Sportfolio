import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft,
  Award,
  ChevronDown,
  ChevronRight,
  Layers,
  RefreshCw,
  Lock,
  CheckCircle2,
  XCircle,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { authenticatedFetch } from "@/lib/queryClient";
import {
  formatCanonicalQuantity,
  basisPointsToProgressValue,
  allocationProgressDisplay,
  compareCanonicalQuantities,
  parseUserQuantityInput,
} from "@/lib/collection-format";
import { extractCollectionApiError, parseCollectionFetchError } from "@/lib/collection-api-error";
import { cn } from "@/lib/utils";
import { formatStatLabel } from "@/lib/collection-stats";
import { openPlayerModal } from "@/lib/player-modal-events";
import { CollectionCeremonyOverlay } from "@/components/ceremonies/collection-ceremony-overlay";
import type { CollectionDetailResponse, CollectionSlotEntry } from "@shared/collection-api";

function buildListQueryKey(userId: string) {
  return ["/api/me/collections", userId] as const;
}

function buildDetailQueryKey(userId: string, slug: string) {
  return ["/api/me/collections", userId, slug] as const;
}

const STALE_PROJECTION_ERROR_CODES = new Set([
  "DEFINITION_VERSION_CHANGED",
  "SLOT_UNAVAILABLE",
  "INSUFFICIENT_AVAILABLE_SHARES",
  "COLLECTION_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
]);

export function mutationErrorRequiresProjectionRefresh(error: {
  code: string;
  status: number;
}): boolean {
  return error.status === 409 || STALE_PROJECTION_ERROR_CODES.has(error.code);
}

async function fetchDetail(slug: string): Promise<CollectionDetailResponse> {
  const res = await authenticatedFetch(`/api/me/collections/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const apiErr = await extractCollectionApiError(res);
    if (apiErr) throw apiErr;
    throw new Error(`Failed to load collection (${res.status})`);
  }
  const json = await res.json();
  return json.data as CollectionDetailResponse;
}

function stateBadge(state: string) {
  switch (state) {
    case "ready":
      return {
        label: "Ready",
        className: "bg-status-live/15 text-status-live border-status-live/30",
      };
    case "active":
      return {
        label: "Active",
        className: "bg-status-live/15 text-status-live border-status-live/30",
      };
    case "in_progress":
      return {
        label: "In Progress",
        className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
      };
    case "inactive":
      return { label: "Inactive", className: "bg-muted text-muted-foreground border-border" };
    default:
      return null;
  }
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="terminal-shell p-4 md:p-5">
        <div className="h-4 w-20 animate-pulse rounded-sm bg-muted/60" />
        <div className="mt-3 h-7 w-56 animate-pulse rounded-sm bg-muted/60" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded-sm bg-muted/40" />
      </div>
      <div className="terminal-shell h-48 animate-pulse bg-muted/25" />
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  is404,
}: {
  message: string;
  onRetry: () => void;
  is404?: boolean;
}) {
  if (is404) {
    return (
      <div className="terminal-shell flex flex-col items-center gap-3 p-8 text-center">
        <div className="rounded-full bg-muted p-3">
          <Layers className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Collection not found</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{message}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/collections">Back to Collections</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="terminal-shell flex flex-col items-center gap-3 p-8 text-center">
      <div className="rounded-full bg-destructive/10 p-3">
        <RefreshCw className="h-5 w-5 text-destructive" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-destructive">Failed to load collection</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">{message}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/collections">Back to Collections</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-retry-detail">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    </div>
  );
}

export default function CollectionDetailPage() {
  const [, params] = useRoute("/collections/:slug");
  const slug = params?.slug ?? "";
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prereqsOpen, setPrereqsOpen] = useState(false);
  const [submittingSlots, setSubmittingSlots] = useState<Set<string>>(new Set());
  const [isCompleting, setIsCompleting] = useState(false);
  const [ceremonyData, setCeremonyData] = useState<{
    title: string;
    artKey: string;
    sport: string;
    family: string;
    kind: "player_slots" | "master";
    points: number;
  } | null>(null);
  // Per-slot input state: slotId → current user input string
  const [slotInputs, setSlotInputs] = useState<Map<string, string>>(new Map());

  const {
    data: detail,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CollectionDetailResponse>({
    queryKey: buildDetailQueryKey(userId, slug),
    queryFn: () => fetchDetail(slug),
    enabled: isAuthenticated && slug.length > 0 && userId.length > 0,
  });

  const refreshCollectionProjection = useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: buildListQueryKey(userId) }),
      queryClient.invalidateQueries({ queryKey: buildDetailQueryKey(userId, slug) }),
    ]);
  }, [queryClient, slug, userId]);

  // ── completion ──────────────────────────────────────────────────────────
  const completeMutation = useMutation({
    mutationFn: async () => {
      setIsCompleting(true);
      const idempotencyKey = crypto.randomUUID();
      const res = await authenticatedFetch(
        `/api/me/collections/${encodeURIComponent(slug)}/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": idempotencyKey,
          },
        },
      );
      if (!res.ok) {
        const apiErr = await extractCollectionApiError(res);
        if (apiErr) throw apiErr;
        throw new Error(`Completion failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (result) => {
      const eventType = result.data?.eventType;
      if (eventType === "completed") {
        toast({ title: "Collection completed" });
        if (detail) {
          setCeremonyData({
            title: detail.title,
            artKey: detail.artKey,
            sport: detail.sport,
            family: detail.family,
            kind: detail.kind,
            points: detail.points,
          });
        }
      } else if (eventType === "reactivated") {
        toast({ title: "Collection reactivated" });
      } else {
        toast({ title: "Collection is already active" });
      }
      queryClient.invalidateQueries({ queryKey: buildListQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: buildDetailQueryKey(userId, slug) });
      setIsCompleting(false);
    },
    onError: (err) => {
      const parsed = parseCollectionFetchError(err);
      if (mutationErrorRequiresProjectionRefresh(parsed)) refreshCollectionProjection();
      toast({
        title: "Completion failed",
        description: parsed.message,
        variant: "destructive",
      });
      setIsCompleting(false);
    },
  });

  // ── allocate ────────────────────────────────────────────────────────────
  const allocateMutation = useMutation({
    mutationFn: async ({ slotId, quantity }: { slotId: string; quantity: string }) => {
      const idempotencyKey = crypto.randomUUID();
      const res = await authenticatedFetch(
        `/api/me/collections/${encodeURIComponent(slug)}/slots/${encodeURIComponent(slotId)}/allocation`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ quantity }),
        },
      );
      if (!res.ok) {
        const apiErr = await extractCollectionApiError(res);
        if (apiErr) throw apiErr;
        throw new Error(`Allocation failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Allocation successful" });
      queryClient.invalidateQueries({ queryKey: buildListQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: buildDetailQueryKey(userId, slug) });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
    },
    onError: (err) => {
      const parsed = parseCollectionFetchError(err);
      if (mutationErrorRequiresProjectionRefresh(parsed)) refreshCollectionProjection();
      toast({
        title: "Allocation failed",
        description: parsed.message,
        variant: "destructive",
      });
    },
  });

  // ── release ─────────────────────────────────────────────────────────────
  const releaseMutation = useMutation({
    mutationFn: async ({ slotId }: { slotId: string }) => {
      const idempotencyKey = crypto.randomUUID();
      const res = await authenticatedFetch(
        `/api/me/collections/${encodeURIComponent(slug)}/slots/${encodeURIComponent(slotId)}/allocation`,
        {
          method: "DELETE",
          headers: {
            "X-Idempotency-Key": idempotencyKey,
          },
        },
      );
      if (!res.ok) {
        const apiErr = await extractCollectionApiError(res);
        if (apiErr) throw apiErr;
        throw new Error(`Release failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Allocation released" });
      queryClient.invalidateQueries({ queryKey: buildListQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: buildDetailQueryKey(userId, slug) });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
    },
    onError: (err) => {
      const parsed = parseCollectionFetchError(err);
      if (mutationErrorRequiresProjectionRefresh(parsed)) refreshCollectionProjection();
      toast({
        title: "Release failed",
        description: parsed.message,
        variant: "destructive",
      });
    },
  });

  const handleAllocate = useCallback(
    (slotId: string, quantity: string) => {
      if (!detail) return;
      if (submittingSlots.has(slotId)) return;
      if (!quantity || parseUserQuantityInput(quantity) === null) return;
      const canonical = parseUserQuantityInput(quantity)!;
      setSubmittingSlots((prev) => new Set(prev).add(slotId));
      allocateMutation.mutate(
        { slotId, quantity: canonical },
        {
          onSettled: () =>
            setSubmittingSlots((prev) => {
              const next = new Set(prev);
              next.delete(slotId);
              return next;
            }),
        },
      );
    },
    [detail, allocateMutation, submittingSlots],
  );

  const handleRelease = useCallback(
    (slotId: string) => {
      if (submittingSlots.has(slotId)) return;
      setSubmittingSlots((prev) => new Set(prev).add(slotId));
      releaseMutation.mutate(
        { slotId },
        {
          onSettled: () =>
            setSubmittingSlots((prev) => {
              const next = new Set(prev);
              next.delete(slotId);
              return next;
            }),
        },
      );
    },
    [releaseMutation, submittingSlots],
  );

  const getDefaultInput = (slot: CollectionSlotEntry): string => {
    if (slotInputs.has(slot.slotId)) return slotInputs.get(slot.slotId)!;
    // Initialize with current allocation or the max allocatable
    const current = slot.allocation?.allocatedQuantity;
    if (current) return formatCanonicalQuantity(current);
    const max = slot.maxAllocatableQuantity;
    if (max) return formatCanonicalQuantity(max);
    return formatCanonicalQuantity(slot.requiredQuantity);
  };

  const setSlotInput = (slotId: string, value: string) => {
    setSlotInputs((prev) => {
      const next = new Map(prev);
      next.set(slotId, value);
      return next;
    });
  };

  // ── loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="terminal-page p-3 sm:p-4" data-testid="collection-detail-loading">
        <div className="mx-auto max-w-3xl">
          <div role="status" aria-live="polite" className="sr-only">
            Loading collection…
          </div>
          <DetailSkeleton />
        </div>
      </div>
    );
  }

  // ── error ───────────────────────────────────────────────────────────────
  if (isError) {
    const is404 =
      error instanceof Error && "isNotFound" in error && (error as any).isNotFound === true;
    return (
      <div className="terminal-page p-3 sm:p-4" data-testid="collection-detail-error">
        <div className="mx-auto max-w-3xl">
          <ErrorState
            message={error instanceof Error ? error.message : "An error occurred."}
            onRetry={() => refetch()}
            is404={is404}
          />
        </div>
      </div>
    );
  }

  // ── data missing (shouldn't normally happen with enabled guard) ──────────
  if (!detail) {
    return (
      <div className="terminal-page p-3 sm:p-4">
        <div className="mx-auto max-w-3xl">
          <ErrorState message="Collection not found" onRetry={() => refetch()} is404 />
        </div>
      </div>
    );
  }

  const pctValue = basisPointsToProgressValue(detail.progressBps);
  const pctLabel = allocationProgressDisplay(detail.progressBps);
  const badge = stateBadge(detail.assemblyState);
  const hasAward = detail.award != null;
  const isReady = detail.assemblyState === "ready";
  const isActive = detail.assemblyState === "active";

  return (
    <div className="terminal-page p-3 sm:p-4" data-testid="collection-detail">
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Back navigation */}
        <div>
          <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2">
            <Link href="/collections">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-xs">Back to Collections</span>
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div
          className={cn(
            "terminal-shell overflow-hidden p-4 md:p-5",
            hasAward && "border-status-live/20",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="terminal-strip text-[10px]">
              {detail.sport} &middot; {detail.season} &middot; {detail.family}
            </span>
            {detail.lifecycleStatus === "final" && (
              <span className="terminal-strip text-[10px]">Final</span>
            )}
            {badge && (
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", badge.className)}>
                {badge.label}
              </Badge>
            )}
            {hasAward && <Award className="h-4 w-4 text-status-live" aria-label="Award earned" />}
          </div>
          <h1 className="mt-2 font-mono text-xl font-bold uppercase tracking-tight text-content">
            {detail.title}
          </h1>
          {detail.description && (
            <p className="mt-1.5 text-sm text-muted-foreground">{detail.description}</p>
          )}
          {detail.qualificationDescription && (
            <p className="mt-2 text-xs text-muted-foreground/80 italic">
              {detail.qualificationDescription}
            </p>
          )}

          {/* Progress */}
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatCanonicalQuantity(detail.allocatedQuantity)} /{" "}
                {formatCanonicalQuantity(detail.requiredQuantity)}{" "}
                {detail.kind === "player_slots" ? "allocated" : "completed"}
              </span>
              <span className="font-mono tabular-nums">{pctLabel}</span>
            </div>
            <Progress
              value={pctValue}
              className={cn("h-2", hasAward && "[&>div]:bg-status-live")}
              aria-label={`${pctLabel} progress`}
            />
          </div>

          {/* Stats row */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {detail.kind === "player_slots" && (
              <span>
                {detail.qualifiedSlotCount} / {detail.requiredSlotCount} slots qualified
              </span>
            )}
            <span className="font-mono tabular-nums">{detail.points} pts</span>
            {detail.award && (
              <span className="text-status-live font-mono">
                Completed {new Date(detail.award.firstCompletedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Complete / Reactivate button */}
          {isReady && !hasAward && (
            <div className="mt-4">
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => completeMutation.mutate()}
                disabled={isCompleting}
                aria-busy={isCompleting}
                data-testid="button-complete-collection"
              >
                <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                {isCompleting ? "Completing…" : "Complete"}
              </Button>
            </div>
          )}
          {isReady && hasAward && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => completeMutation.mutate()}
                disabled={isCompleting}
                aria-busy={isCompleting}
                data-testid="button-reactivate-collection"
              >
                <Award className="h-3.5 w-3.5" aria-hidden="true" />
                {isCompleting ? "Reactivating…" : "Reactivate"}
              </Button>
            </div>
          )}
          {isActive && (
            <div className="mt-4 flex items-center gap-2 text-xs text-status-live">
              <Award className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Active</span>
            </div>
          )}
        </div>

        {/* Slots section (player_slots) */}
        {detail.kind === "player_slots" && detail.slots.length > 0 && (
          <div className="terminal-shell overflow-hidden p-4 md:p-5">
            <div className="terminal-strip mb-3">Slots</div>
            <div className="space-y-2" data-testid="collection-slots">
              {detail.slots.map((slot) => {
                const hasAllocation = slot.allocation != null;
                const isAllocated = hasAllocation && slot.allocation!.status === "active";
                const isSubmitting = submittingSlots.has(slot.slotId);
                const isAllocating =
                  allocateMutation.isPending && allocateMutation.variables?.slotId === slot.slotId;
                const isReleasing =
                  releaseMutation.isPending && releaseMutation.variables?.slotId === slot.slotId;
                const inputValue = getDefaultInput(slot);
                const parsed = parseUserQuantityInput(inputValue);
                const withinAvailableMaximum =
                  parsed !== null &&
                  slot.maxAllocatableQuantity !== null &&
                  compareCanonicalQuantities(parsed, slot.maxAllocatableQuantity) <= 0;
                const canSubmit =
                  !isSubmitting && parsed !== null && parsed !== "0.0000" && withinAvailableMaximum;

                return (
                  <div
                    key={slot.slotId}
                    className={cn(
                      "terminal-shell flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between",
                      isAllocated && "border-status-live/20",
                    )}
                    data-testid={`slot-${slot.slotId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {!slot.isRequired && (
                          <span className="text-[10px] text-muted-foreground">Optional</span>
                        )}
                        {isAllocated && (
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-status-live flex-shrink-0"
                            aria-label="Allocated"
                          />
                        )}
                        {isSubmitting && (
                          <span className="text-[10px] text-amber-500" aria-live="polite">
                            {isReleasing ? "Releasing…" : "Allocating…"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">
                          {formatCanonicalQuantity(slot.requiredQuantity)} required
                        </span>
                        {slot.player && (
                          <span className="flex items-center gap-1.5">
                            <span
                              className="text-primary underline cursor-pointer hover:text-brand transition-colors"
                              onClick={() => openPlayerModal(slot.player.playerId)}
                            >
                              {`${slot.player.firstName} ${slot.player.lastName}`.trim() || "--"}
                            </span>
                            <span className="text-muted-foreground">&middot;</span>
                            <span className="text-muted-foreground">{slot.player.team}</span>
                            <span className="text-muted-foreground">&middot;</span>
                            <span className="text-muted-foreground">{slot.player.position}</span>
                            {slot.qualificationValue && slot.statLabel && (
                              <span className="font-mono text-xs font-medium text-brand">
                                {slot.qualificationValue} {slot.statLabel}
                              </span>
                            )}
                          </span>
                        )}
                        {slot.maxAllocatableQuantity && (
                          <span className="font-mono">
                            Max: {formatCanonicalQuantity(slot.maxAllocatableQuantity)}
                          </span>
                        )}
                      </div>
                      {hasAllocation && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          <span className="font-mono">
                            Allocated: {formatCanonicalQuantity(slot.allocation!.allocatedQuantity)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Action area */}
                    <div
                      className="flex-shrink-0 self-end sm:self-center"
                      role="region"
                      aria-label={slot.slotLabel}
                      aria-busy={isSubmitting}
                    >
                      {isAllocated ? (
                        <div className="flex items-center gap-1.5">
                          {/* Quantity input for adjusting active allocation */}
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              inputMode="decimal"
                              className="h-7 w-20 text-[10px] font-mono px-1.5"
                              value={inputValue}
                              onChange={(e) => setSlotInput(slot.slotId, e.target.value)}
                              disabled={isSubmitting}
                              aria-label={`Allocation quantity for ${slot.slotLabel}`}
                              data-testid={`input-quantity-${slot.slotId}`}
                            />
                            <div className="flex items-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[10px] px-1.5"
                                onClick={() =>
                                  setSlotInput(
                                    slot.slotId,
                                    formatCanonicalQuantity(
                                      slot.maxAllocatableQuantity || slot.requiredQuantity,
                                    ),
                                  )
                                }
                                disabled={isSubmitting || !slot.maxAllocatableQuantity}
                                aria-label={`Fill max: ${formatCanonicalQuantity(slot.maxAllocatableQuantity || slot.requiredQuantity)}`}
                              >
                                Max
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[10px] px-1.5"
                                onClick={() =>
                                  setSlotInput(
                                    slot.slotId,
                                    formatCanonicalQuantity(slot.requiredQuantity),
                                  )
                                }
                                disabled={isSubmitting}
                                aria-label={`Fill required: ${formatCanonicalQuantity(slot.requiredQuantity)}`}
                              >
                                Req
                              </Button>
                            </div>
                            <Button
                              variant="default"
                              size="sm"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => handleAllocate(slot.slotId, inputValue)}
                              disabled={!canSubmit}
                              data-testid={`button-allocate-${slot.slotId}`}
                              aria-busy={isSubmitting}
                              aria-label={`${isAllocating ? "Allocating" : "Set allocation"} for ${slot.slotLabel}`}
                            >
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              {isAllocating ? "Allocating…" : "Set"}
                            </Button>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] gap-1"
                            onClick={() => handleRelease(slot.slotId)}
                            disabled={isSubmitting}
                            data-testid={`button-release-${slot.slotId}`}
                            aria-busy={isSubmitting}
                            aria-label={`${isReleasing ? "Releasing" : "Release allocation"} from ${slot.slotLabel}`}
                          >
                            <XCircle className="h-3 w-3" aria-hidden="true" />
                            {isReleasing ? "Releasing…" : "Release"}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="h-7 w-20 text-[10px] font-mono px-1.5"
                            value={inputValue}
                            onChange={(e) => setSlotInput(slot.slotId, e.target.value)}
                            disabled={isSubmitting || isActive}
                            aria-label={`Allocation quantity for ${slot.slotLabel}`}
                            data-testid={`input-quantity-${slot.slotId}`}
                          />
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[10px] px-1.5"
                              onClick={() =>
                                setSlotInput(
                                  slot.slotId,
                                  formatCanonicalQuantity(
                                    slot.maxAllocatableQuantity || slot.requiredQuantity,
                                  ),
                                )
                              }
                              disabled={isSubmitting || isActive || !slot.maxAllocatableQuantity}
                              aria-label={`Fill max: ${formatCanonicalQuantity(slot.maxAllocatableQuantity || slot.requiredQuantity)}`}
                            >
                              Max
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[10px] px-1.5"
                              onClick={() =>
                                setSlotInput(
                                  slot.slotId,
                                  formatCanonicalQuantity(slot.requiredQuantity),
                                )
                              }
                              disabled={isSubmitting || isActive}
                              aria-label={`Fill required: ${formatCanonicalQuantity(slot.requiredQuantity)}`}
                            >
                              Req
                            </Button>
                          </div>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-[10px] gap-1"
                            onClick={() => handleAllocate(slot.slotId, inputValue)}
                            disabled={!canSubmit || isActive}
                            data-testid={`button-allocate-${slot.slotId}`}
                            aria-busy={isSubmitting}
                            aria-label={`${isAllocating ? "Allocating" : "Allocate"} ${slot.slotLabel}`}
                          >
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            {isAllocating ? "Allocating…" : "Allocate"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Prerequisites section (master collections) */}
        {detail.kind === "master" && detail.prerequisites.length > 0 && (
          <Collapsible
            open={prereqsOpen}
            onOpenChange={setPrereqsOpen}
            className="terminal-shell overflow-hidden p-4 md:p-5"
            data-testid="collection-prerequisites"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
              <div className="terminal-strip">Prerequisites</div>
              {prereqsOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-2">
              {detail.prerequisites.map((prereq) => {
                const prereqPct = basisPointsToProgressValue(prereq.state.progressBps);
                const prereqPctLabel = allocationProgressDisplay(prereq.state.progressBps);
                const prereqBadge = stateBadge(prereq.state.assemblyState);
                const prereqComplete = prereq.state.assemblyState === "active";

                return (
                  <Link
                    key={prereq.prerequisiteId}
                    href={`/collections/${prereq.slug}`}
                    className={cn(
                      "terminal-shell group flex items-center justify-between gap-3 p-3 transition-colors hover:border-brand/40",
                      prereqComplete && "border-status-live/20",
                    )}
                    data-testid={`prerequisite-${prereq.prerequisiteId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-content group-hover:text-brand">
                          {prereq.title}
                        </span>
                        {prereqBadge && (
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] px-1 py-0", prereqBadge.className)}
                          >
                            {prereqBadge.label}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Progress
                          value={prereqPct}
                          className={cn(
                            "h-1 flex-1 max-w-24",
                            prereqComplete && "[&>div]:bg-status-live",
                          )}
                          aria-label={`${prereqPctLabel}`}
                        />
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                          {prereqPctLabel}
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40"
                      aria-hidden="true"
                    />
                  </Link>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* No slots or prereqs */}
        {detail.kind === "player_slots" && detail.slots.length === 0 && (
          <div className="terminal-shell p-6 text-center text-xs text-muted-foreground">
            No slots configured for this collection.
          </div>
        )}
        {detail.kind === "master" && detail.prerequisites.length === 0 && (
          <div className="terminal-shell p-6 text-center text-xs text-muted-foreground">
            No prerequisites configured for this collection.
          </div>
        )}
      </div>
      <CollectionCeremonyOverlay
        isOpen={!!ceremonyData}
        data={ceremonyData}
        onClose={() => setCeremonyData(null)}
      />
    </div>
  );
}
