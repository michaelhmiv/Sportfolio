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
  CheckCircle2,
  XCircle,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CollectionArt } from "@/components/collection-art";
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

export function allocationInputWithinMaximum(input: string, maximum: string | null): boolean {
  const parsed = parseUserQuantityInput(input);
  return (
    parsed !== null &&
    parsed !== "0.0000" &&
    maximum !== null &&
    compareCanonicalQuantities(parsed, maximum) <= 0
  );
}

export function canManageSlotAllocation(slot: CollectionSlotEntry, isActive: boolean): boolean {
  if (!slot.player) return false;
  if (slot.allocation?.status === "active") return true;
  return (
    !isActive &&
    slot.maxAllocatableQuantity !== null &&
    compareCanonicalQuantities(slot.maxAllocatableQuantity, "0.0000") > 0
  );
}

export function getFirstActionableSlot(
  slots: CollectionSlotEntry[],
  isActive: boolean,
): CollectionSlotEntry | undefined {
  if (isActive) return undefined;
  return slots.find((slot) => {
    if (!slot.player || slot.maxAllocatableQuantity === null) return false;
    const allocated =
      slot.allocation?.status === "active" ? slot.allocation.allocatedQuantity : "0.0000";
    return (
      compareCanonicalQuantities(allocated, slot.requiredQuantity) < 0 &&
      compareCanonicalQuantities(slot.maxAllocatableQuantity, allocated) > 0
    );
  });
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
        className: "bg-status-warning/15 text-status-warning border-status-warning/30",
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
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [submittingSlots, setSubmittingSlots] = useState<Set<string>>(new Set());
  const [isCompleting, setIsCompleting] = useState(false);
  const [ceremonyData, setCeremonyData] = useState<{
    title: string;
    artKey: string;
    sport: string;
    family: string;
    kind: "player_slots" | "master";
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
  const selectedSlot = detail.slots.find((slot) => slot.slotId === selectedSlotId) ?? null;
  const selectedInput = selectedSlot ? getDefaultInput(selectedSlot) : "";
  const selectedParsed = parseUserQuantityInput(selectedInput);
  const selectedWithinMaximum =
    selectedSlot !== null &&
    selectedParsed !== null &&
    selectedSlot.maxAllocatableQuantity !== null &&
    compareCanonicalQuantities(selectedParsed, selectedSlot.maxAllocatableQuantity) <= 0;
  const selectedCanSubmit =
    selectedSlot !== null &&
    (!isActive || selectedSlot.allocation?.status === "active") &&
    !submittingSlots.has(selectedSlot.slotId) &&
    allocationInputWithinMaximum(selectedInput, selectedSlot.maxAllocatableQuantity);
  const remainingSlots = Math.max(0, detail.requiredSlotCount - detail.qualifiedSlotCount);
  const firstManageableSlot = getFirstActionableSlot(detail.slots, isActive);

  return (
    <div
      className="terminal-page p-3 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:p-4"
      data-testid="collection-detail"
    >
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
            "relative overflow-hidden rounded-panel border border-border-strong bg-surface p-4 shadow-medium md:p-6",
            hasAward && "border-brand/40",
          )}
          data-testid="collection-immersive-hero"
        >
          <div
            className="absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-status-info/10"
            aria-hidden="true"
          />
          <div className="relative flex items-start gap-4">
            <CollectionArt
              artKey={detail.artKey}
              sport={detail.sport}
              family={detail.family}
              season={detail.season}
              title={detail.title}
              kind={detail.kind}
              assemblyState={detail.assemblyState}
              award={detail.award}
              size="lg"
              className="h-36 w-28"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="terminal-strip text-[10px]">
                  {detail.sport} &middot; {detail.season} &middot; {detail.family}
                </span>
                {detail.lifecycleStatus === "final" && (
                  <span className="terminal-strip text-[10px]">Final</span>
                )}
                {badge && (
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0", badge.className)}
                  >
                    {hasAward && detail.assemblyState === "inactive"
                      ? "Earned · Inactive"
                      : badge.label}
                  </Badge>
                )}
                {hasAward && (
                  <Award className="h-4 w-4 text-status-live" aria-label="Award earned" />
                )}
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
          </div>
        </div>

        {/* Player slots are scan-friendly cards; quantity management lives in one focus-trapped sheet. */}
        {detail.kind === "player_slots" && detail.slots.length > 0 && (
          <section aria-labelledby="collection-slots-heading" className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
                  Roster
                </p>
                <h2 id="collection-slots-heading" className="text-lg font-bold text-content">
                  Collection slots
                </h2>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {detail.qualifiedSlotCount}/{detail.requiredSlotCount} qualified
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2" data-testid="collection-slots">
              {detail.slots.map((slot) => {
                const allocationActive = slot.allocation?.status === "active";
                const allocated = slot.allocation?.allocatedQuantity ?? "0.0000";
                const ownsAny =
                  slot.maxAllocatableQuantity !== null && slot.maxAllocatableQuantity !== "0.0000";
                const fullyAllocated =
                  allocationActive &&
                  compareCanonicalQuantities(allocated, slot.requiredQuantity) >= 0;
                const slotState =
                  slot.player === null
                    ? "Vacant"
                    : fullyAllocated
                      ? "Fully allocated"
                      : allocationActive
                        ? "Partially allocated"
                        : ownsAny &&
                            compareCanonicalQuantities(
                              slot.maxAllocatableQuantity!,
                              slot.requiredQuantity,
                            ) >= 0
                          ? "Ready to allocate"
                          : ownsAny
                            ? "More shares needed"
                            : "No shares owned";
                const playerName = slot.player
                  ? `${slot.player.firstName} ${slot.player.lastName}`.trim() || slot.slotLabel
                  : slot.slotLabel;

                return (
                  <article
                    key={slot.slotId}
                    className={cn(
                      "relative overflow-hidden rounded-panel border border-border-subtle bg-surface p-4 shadow-low",
                      fullyAllocated && "border-status-live/35",
                      !slot.isRequired && "border-dashed",
                    )}
                    data-testid={`collection-slot-card-${slot.slotId}`}
                  >
                    <div
                      className="absolute right-3 top-2 font-mono text-4xl font-black text-content/[0.06]"
                      aria-hidden="true"
                    >
                      {slot.rank ?? slot.displayOrder}
                    </div>
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                          <span
                            className={
                              fullyAllocated ? "text-status-live" : "text-muted-foreground"
                            }
                          >
                            {slotState}
                          </span>
                          {!slot.isRequired && <span className="text-brand">Optional</span>}
                        </div>
                        {slot.player ? (
                          <button
                            type="button"
                            className="mt-2 min-h-11 text-left text-base font-bold text-content underline-offset-4 hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                            onClick={() => openPlayerModal(slot.player!.playerId)}
                          >
                            {playerName}
                          </button>
                        ) : (
                          <h3 className="mt-3 text-base font-bold text-muted-foreground">
                            {playerName}
                          </h3>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {slot.player
                            ? `${slot.player.team} · ${slot.player.position}`
                            : "Awaiting assignment"}
                        </p>
                      </div>
                      {fullyAllocated && (
                        <CheckCircle2
                          className="h-5 w-5 shrink-0 text-status-live"
                          aria-label="Fully allocated"
                        />
                      )}
                    </div>
                    <dl className="relative mt-4 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-xs">
                      <div>
                        <dt className="text-[9px] uppercase text-muted-foreground">Required</dt>
                        <dd className="font-mono font-bold">
                          {formatCanonicalQuantity(slot.requiredQuantity)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[9px] uppercase text-muted-foreground">Available</dt>
                        <dd className="font-mono font-bold">
                          {slot.maxAllocatableQuantity
                            ? formatCanonicalQuantity(slot.maxAllocatableQuantity)
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[9px] uppercase text-muted-foreground">Allocated</dt>
                        <dd className="font-mono font-bold">
                          {formatCanonicalQuantity(allocated)}
                        </dd>
                      </div>
                    </dl>
                    {slot.qualificationValue && (
                      <p className="relative mt-3 text-xs font-semibold text-brand">
                        {slot.qualificationValue}{" "}
                        {slot.statLabel || (slot.statKey ? formatStatLabel(slot.statKey) : "")}
                      </p>
                    )}
                    {canManageSlotAllocation(slot, isActive) && (
                      <Button
                        type="button"
                        variant={allocationActive ? "outline" : "default"}
                        className="relative mt-4 min-h-11 w-full"
                        onClick={() => setSelectedSlotId(slot.slotId)}
                        disabled={submittingSlots.has(slot.slotId)}
                        aria-label={`Manage allocation for ${slot.slotLabel}`}
                        data-testid={`button-open-allocation-${slot.slotId}`}
                      >
                        {allocationActive ? "Manage allocation" : "Allocate shares"}
                        <span className="sr-only"> for {slot.slotLabel}</span>
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
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

      <Sheet open={selectedSlot !== null} onOpenChange={(open) => !open && setSelectedSlotId(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"
          data-testid="collection-allocation-sheet"
        >
          {selectedSlot && (
            <>
              <SheetHeader className="pr-10 text-left">
                <SheetTitle>Manage allocation for {selectedSlot.slotLabel}</SheetTitle>
                <SheetDescription>
                  {selectedSlot.player
                    ? `${selectedSlot.player.firstName} ${selectedSlot.player.lastName} · ${selectedSlot.player.team} · ${selectedSlot.player.position}`
                    : "Choose the exact number of shares to allocate."}
                </SheetDescription>
              </SheetHeader>
              <dl className="my-5 grid grid-cols-3 gap-2 rounded-panel border border-border-subtle bg-surface p-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Required</dt>
                  <dd className="font-mono font-bold">
                    {formatCanonicalQuantity(selectedSlot.requiredQuantity)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Available</dt>
                  <dd className="font-mono font-bold">
                    {selectedSlot.maxAllocatableQuantity
                      ? formatCanonicalQuantity(selectedSlot.maxAllocatableQuantity)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Allocated</dt>
                  <dd className="font-mono font-bold">
                    {formatCanonicalQuantity(
                      selectedSlot.allocation?.allocatedQuantity ?? "0.0000",
                    )}
                  </dd>
                </div>
              </dl>
              <div className="space-y-2">
                <label
                  htmlFor={`allocation-${selectedSlot.slotId}`}
                  className="text-sm font-semibold text-content"
                >
                  Allocation quantity
                </label>
                <Input
                  id={`allocation-${selectedSlot.slotId}`}
                  type="text"
                  inputMode="decimal"
                  className="h-12 text-base font-mono"
                  value={selectedInput}
                  onChange={(event) => setSlotInput(selectedSlot.slotId, event.target.value)}
                  disabled={submittingSlots.has(selectedSlot.slotId)}
                  aria-invalid={selectedInput.length > 0 && !selectedCanSubmit}
                  aria-describedby={`allocation-help-${selectedSlot.slotId}`}
                  data-testid={`input-quantity-${selectedSlot.slotId}`}
                />
                <p
                  id={`allocation-help-${selectedSlot.slotId}`}
                  className={cn(
                    "text-xs",
                    selectedInput.length > 0 && !selectedCanSubmit
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {selectedInput.length === 0 || selectedParsed === null
                    ? "Enter a positive quantity with up to four decimal places."
                    : !selectedWithinMaximum
                      ? "Quantity exceeds the shares currently available."
                      : "This sets the total allocation for this slot."}
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() =>
                      setSlotInput(
                        selectedSlot.slotId,
                        formatCanonicalQuantity(selectedSlot.requiredQuantity),
                      )
                    }
                    disabled={submittingSlots.has(selectedSlot.slotId)}
                  >
                    Use Required
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() =>
                      selectedSlot.maxAllocatableQuantity &&
                      setSlotInput(
                        selectedSlot.slotId,
                        formatCanonicalQuantity(selectedSlot.maxAllocatableQuantity),
                      )
                    }
                    disabled={
                      submittingSlots.has(selectedSlot.slotId) ||
                      !selectedSlot.maxAllocatableQuantity
                    }
                  >
                    Use Maximum
                  </Button>
                </div>
              </div>
              <SheetFooter className="mt-5 gap-2 sm:space-x-0">
                {selectedSlot.allocation?.status === "active" && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => handleRelease(selectedSlot.slotId)}
                    disabled={submittingSlots.has(selectedSlot.slotId)}
                    data-testid={`button-release-${selectedSlot.slotId}`}
                  >
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Release allocation
                  </Button>
                )}
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => handleAllocate(selectedSlot.slotId, selectedInput)}
                  disabled={!selectedCanSubmit}
                  aria-busy={submittingSlots.has(selectedSlot.slotId)}
                  data-testid={`button-allocate-${selectedSlot.slotId}`}
                >
                  Confirm allocation
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {(isReady || firstManageableSlot) && (
        <div
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-panel border border-border-strong bg-overlay/95 p-3 shadow-overlay backdrop-blur sm:sticky sm:inset-x-auto sm:bottom-4"
          data-testid="collection-mobile-action-bar"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-content">
              {isReady
                ? hasAward
                  ? "Earned · Ready to reactivate"
                  : "Ready to complete"
                : isActive
                  ? "Active · Manage shares"
                  : `${remainingSlots} slots remaining`}
            </p>
            <p className="text-xs text-muted-foreground">Your next collection action</p>
          </div>
          {isReady ? (
            <Button
              type="button"
              className="min-h-11 shrink-0"
              onClick={() => completeMutation.mutate()}
              disabled={isCompleting}
              aria-busy={isCompleting}
            >
              {hasAward ? "Reactivate" : "Complete Collection"}
            </Button>
          ) : firstManageableSlot ? (
            <Button
              type="button"
              className="min-h-11 shrink-0"
              onClick={() => setSelectedSlotId(firstManageableSlot.slotId)}
            >
              {isActive ? "Manage Shares" : "Continue"}
            </Button>
          ) : null}
        </div>
      )}
      <CollectionCeremonyOverlay
        isOpen={!!ceremonyData}
        data={ceremonyData}
        onClose={() => setCeremonyData(null)}
      />
    </div>
  );
}
