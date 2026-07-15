import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Globe,
  Loader2,
  Lock,
  RefreshCw,
  RotateCw,
  Settings,
  Shield,
  Trophy,
  X,
} from "lucide-react";
import type {
  PublicProfileResponse,
  PrivateProfileSentinel,
  TrophyCaseEditorResponse,
  EligibleCollectionEntry,
  PublicBadgeEntry,
  PublicFeaturedEntry,
} from "@shared/trophy-case";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ── types ────────────────────────────────────────────────────────────────────

type ProfileData = PublicProfileResponse | PrivateProfileSentinel;

// ── style tokens ─────────────────────────────────────────────────────────────

const S = {
  pageTitle: "text-xl font-bold sm:text-2xl",
  sectionTitle: "terminal-heading text-sm font-medium uppercase tracking-wide",
  label: "text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs",
  meta: "text-[10px] text-muted-foreground sm:text-xs",
  body: "text-xs text-muted-foreground sm:text-sm",
  primaryValue: "font-mono text-base font-bold sm:text-xl",
  secondaryValue: "font-mono text-xs font-semibold sm:text-sm",
} as const;

// ── helpers ──────────────────────────────────────────────────────────────────

function usernameFallback(username: string | null): string {
  return username || "User";
}

function initials(username: string | null): string {
  return (username || "??").slice(0, 2).toUpperCase();
}

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

// ── loading skeleton ─────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div
      className="terminal-page p-3 sm:p-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Header skeleton */}
        <Card variant="terminal">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-circle" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Trophy case skeleton */}
        <Card variant="terminal">
          <CardHeader>
            <CardTitle className={S.sectionTitle}>
              <Skeleton className="h-4 w-24" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 sm:p-6 pt-0">
            <Skeleton className="h-8 w-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── error state ──────────────────────────────────────────────────────────────

function ProfileError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="terminal-page flex items-center justify-center p-4"
      role="alert"
      aria-label="Profile failed to load"
    >
      <Card variant="terminal" className="max-w-sm text-center">
        <CardContent className="py-8 space-y-4">
          <AlertTriangle className="mx-auto h-8 w-8 text-status-warning" />
          <p className="text-sm text-muted-foreground">
            Could not load this profile. The server may be unreachable.
          </p>
          <Button variant="terminalOutline" size="sm" className="gap-2" onClick={onRetry}>
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── not found state ──────────────────────────────────────────────────────────

function ProfileNotFound() {
  return (
    <div className="terminal-page flex items-center justify-center p-4">
      <Card variant="terminal" className="max-w-sm text-center">
        <CardContent className="py-8">
          <EmptyState
            icon="file"
            title="User Not Found"
            headingLevel={1}
            description="This user does not exist or their account has been deleted."
            size="sm"
            variant="terminal"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── private profile state ────────────────────────────────────────────────────

function PrivateProfile() {
  return (
    <div className="terminal-page flex items-center justify-center p-4">
      <Card variant="terminal" className="max-w-sm text-center">
        <CardContent className="py-8">
          <EmptyState
            icon={<Lock className="h-8 w-8" />}
            title="Private Profile"
            headingLevel={1}
            description="This user has set their profile to private."
            size="sm"
            variant="terminal"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── badge chip ───────────────────────────────────────────────────────────────

function BadgeChip({ badge }: { badge: PublicBadgeEntry }) {
  const c = badge.collection;
  return (
    <div
      className="flex items-center gap-2 rounded-control border border-premium/30 bg-premium-subtle/40 px-3 py-2"
      aria-label={`Badge: ${c.title}`}
    >
      <Trophy className="h-4 w-4 shrink-0 text-premium" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-content">{c.title}</div>
        <div className="text-[10px] text-muted-foreground">
          {c.sport} &middot; {c.season}
        </div>
      </div>
    </div>
  );
}

// ── collection art ────────────────────────────────────────────────────────────
// Deterministic visual from identity metadata — never renders raw artKey text.

function CollectionArt({
  collection,
}: {
  collection: { sport: string; family: string; kind: string; title: string };
}) {
  const sportMark = collection.sport.slice(0, 3).toUpperCase();
  const isMaster = collection.kind === "master";

  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-control border font-mono text-[10px] font-bold tracking-[0.08em]",
        isMaster
          ? "border-premium/30 bg-premium-subtle/20 text-premium"
          : "border-border bg-panel text-content",
      )}
      aria-hidden="true"
    >
      <span>{sportMark}</span>
    </div>
  );
}

// ── featured card ────────────────────────────────────────────────────────────

function FeaturedCard({
  featured,
  canNavigate,
}: {
  featured: PublicFeaturedEntry;
  canNavigate: boolean;
}) {
  const c = featured.collection;
  const content = (
    <div
      className={cn(
        "rounded-control border border-border p-3",
        canNavigate &&
          "group cursor-pointer transition-colors hover:border-premium/30 hover:bg-premium-subtle/10 hover-elevate",
      )}
    >
      <div className="flex items-start gap-3">
        <CollectionArt collection={c} />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-sm font-semibold text-content",
              canNavigate && "transition-colors group-hover:text-premium",
            )}
          >
            {c.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>
              {c.sport} {c.league} &middot; {c.season}
            </span>
            {c.lifecycleStatus === "final" && (
              <Badge variant="neutral" className="text-[9px] px-1 py-0">
                Final
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (!canNavigate) {
    return <div aria-label={`Featured collection: ${c.title}`}>{content}</div>;
  }

  return (
    <Link
      href={`/collections/${encodeURIComponent(c.slug)}`}
      aria-label={`Featured collection: ${c.title}`}
    >
      {content}
    </Link>
  );
}

// ── trophy case public view ──────────────────────────────────────────────────

function TrophyCasePublic({
  badges,
  featured,
  canNavigateCollections,
}: {
  badges: PublicBadgeEntry[];
  featured: PublicFeaturedEntry[];
  canNavigateCollections: boolean;
}) {
  return (
    <Card variant="terminal">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className={S.sectionTitle}>
          Trophy Case
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6 pt-0">
        {/* Badges */}
        <div>
          <h3 className={cn(S.label, "mb-2")}>Badges</h3>
          {badges.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No badges selected.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {badges.map((b) => (
                <li key={b.definitionId}>
                  <BadgeChip badge={b} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Separator */}
        <div className="border-t border-border" />

        {/* Featured */}
        <div>
          <h3 className={cn(S.label, "mb-2")}>Featured Collections</h3>
          {featured.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No featured collections selected.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {featured.map((f) => (
                <li key={f.definitionId}>
                  <FeaturedCard featured={f} canNavigate={canNavigateCollections} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── header section ───────────────────────────────────────────────────────────

function ProfileHeader({ profile }: { profile: PublicProfileResponse }) {
  const nm = usernameFallback(profile.username);

  return (
    <Card variant="terminal">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16 sm:h-20 sm:w-20 shrink-0">
            <AvatarImage src={profile.profileImageUrl || undefined} alt={nm} />
            <AvatarFallback className="text-lg">{initials(profile.username)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={cn(S.pageTitle, "truncate")}>
                {profile.username ? `@${profile.username}` : "Unnamed User"}
              </h1>
              {profile.isPremium && (
                <Badge variant="premium" className="gap-1">
                  <Shield className="h-3 w-3" />
                  Premium
                </Badge>
              )}
            </div>
            <div className={cn("mt-2 flex flex-wrap items-center gap-x-3 gap-y-1", S.meta)}>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Member since {memberSince(profile.createdAt)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── public profile view ──────────────────────────────────────────────────────

function PublicProfileView({ profile }: { profile: PublicProfileResponse }) {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ProfileHeader profile={profile} />
      {profile.isOwner && profile.profileVisibility === "private" && (
        <div
          className="flex items-center gap-2 rounded-control border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-content"
          role="status"
        >
          <Lock className="h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
          <span>Your profile is private. Only you can see this Trophy Case.</span>
        </div>
      )}
      {profile.isOwner && <OwnerEditor />}
      {profile.badges.length === 0 && profile.featured.length === 0 ? (
        <Card variant="terminal">
          <CardContent className="py-8">
            <EmptyState
              icon="trophy"
              title="Trophy Case Empty"
              headingLevel={2}
              description={
                profile.isOwner
                  ? "Select badges and featured collections to showcase them on your public profile."
                  : "This user has not added any trophies to their case yet."
              }
              size="sm"
              variant="terminal"
            />
          </CardContent>
        </Card>
      ) : (
        <TrophyCasePublic
          badges={profile.badges}
          featured={profile.featured}
          canNavigateCollections={!!user}
        />
      )}
    </div>
  );
}

// ── editor: selected list ────────────────────────────────────────────────────

function SelectedList({
  ids,
  entries,
  listKind,
  onRemove,
  onMoveUp,
  onMoveDown,
  maxCount,
}: {
  ids: string[];
  entries: Map<string, EligibleCollectionEntry>;
  listKind: "badge" | "featured";
  onRemove: (defId: string) => void;
  onMoveUp: (defId: string) => void;
  onMoveDown: (defId: string) => void;
  maxCount: number;
}) {
  if (ids.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        None selected ({ids.length}/{maxCount}).
      </p>
    );
  }

  return (
    <div className="space-y-1.5" role="list" aria-label={`Selected ${listKind}`}>
      {ids.map((defId, idx) => {
        const item = entries.get(defId);
        if (!item) return null;
        const isFirst = idx === 0;
        const isLast = idx === ids.length - 1;

        return (
          <div
            key={defId}
            className="flex items-center gap-2 rounded-control border border-premium/30 bg-premium-subtle/20 px-3 py-2"
            role="listitem"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-content">{item.title}</div>
              <div className="text-[10px] text-muted-foreground">
                {item.sport} {item.league} &middot; {item.season}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                className="flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-content disabled:opacity-30"
                onClick={() => onMoveUp(defId)}
                disabled={isFirst}
                aria-label={`Move ${item.title} up in ${listKind}`}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-content disabled:opacity-30"
                onClick={() => onMoveDown(defId)}
                disabled={isLast}
                aria-label={`Move ${item.title} down in ${listKind}`}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground hover:bg-destructive-subtle hover:text-destructive"
                onClick={() => onRemove(defId)}
                aria-label={`Remove ${item.title} from ${listKind}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── owner editor ─────────────────────────────────────────────────────────────

function OwnerEditor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const [isOpen, setIsOpen] = useState(false);

  // Editor state query (only for owner)
  const editorQuery = useQuery<TrophyCaseEditorResponse>({
    queryKey: ["/api/me/trophy-case", user?.id],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/me/trophy-case");
      if (!response.ok) throw new Error(`${response.status}: Failed to load trophy case`);
      return response.json() as Promise<TrophyCaseEditorResponse>;
    },
    enabled: isOpen,
    staleTime: 30_000,
  });

  // Local UI state synced from server
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [badgeIds, setBadgeIds] = useState<string[]>([]);
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);
  const [reorderStatus, setReorderStatus] = useState("");

  // Sync on data arrival
  useEffect(() => {
    if (editorQuery.data) {
      setVisibility(editorQuery.data.profileVisibility);
      setBadgeIds(editorQuery.data.badgeDefinitionIds);
      setFeaturedIds(editorQuery.data.featuredDefinitionIds);
    }
  }, [editorQuery.data]);

  const resetDraft = useCallback(() => {
    if (!editorQuery.data) return;
    setVisibility(editorQuery.data.profileVisibility);
    setBadgeIds(editorQuery.data.badgeDefinitionIds);
    setFeaturedIds(editorQuery.data.featuredDefinitionIds);
  }, [editorQuery.data]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetDraft();
      setReorderStatus("");
    }
    setIsOpen(open);
  };

  const openEditor = () => {
    resetDraft();
    setIsOpen(true);
  };

  // Build lookup maps
  const eligibleByDef = useMemo(() => {
    const map = new Map<string, EligibleCollectionEntry>();
    if (editorQuery.data?.eligibleCollections) {
      for (const c of editorQuery.data.eligibleCollections) {
        map.set(c.definitionId, c);
      }
    }
    return map;
  }, [editorQuery.data]);

  const eligibleCollections = useMemo(() => {
    return editorQuery.data?.eligibleCollections ?? [];
  }, [editorQuery.data]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/me/trophy-case", {
        profileVisibility: visibility,
        badgeDefinitionIds: badgeIds,
        featuredDefinitionIds: featuredIds,
      });
      return res.json() as Promise<TrophyCaseEditorResponse>;
    },
    onSuccess: (savedState) => {
      queryClient.setQueryData(["/api/me/trophy-case", user?.id], savedState);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Trophy case saved",
        description:
          savedState.profileVisibility === "public"
            ? "Your Trophy Case is live on your public profile."
            : "Your Trophy Case is saved and remains private.",
      });
      setVisibility(savedState.profileVisibility);
      setBadgeIds(savedState.badgeDefinitionIds);
      setFeaturedIds(savedState.featuredDefinitionIds);
      setIsOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAdd = (defId: string, listKind: "badge" | "featured") => {
    if (listKind === "badge") {
      if (badgeIds.length >= 5) return;
      if (badgeIds.includes(defId)) return;
      setBadgeIds([...badgeIds, defId]);
    } else {
      if (featuredIds.length >= 4) return;
      if (featuredIds.includes(defId)) return;
      setFeaturedIds([...featuredIds, defId]);
    }
  };

  const handleRemove = (defId: string, listKind: "badge" | "featured") => {
    if (listKind === "badge") {
      setBadgeIds(badgeIds.filter((id) => id !== defId));
    } else {
      setFeaturedIds(featuredIds.filter((id) => id !== defId));
    }
  };

  const handleMoveUp = (defId: string, listKind: "badge" | "featured") => {
    const list = listKind === "badge" ? badgeIds : featuredIds;
    const setter = listKind === "badge" ? setBadgeIds : setFeaturedIds;
    const idx = list.indexOf(defId);
    if (idx <= 0) return;
    const next = [...list];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setter(next);
    const title = eligibleByDef.get(defId)?.title ?? "Collection";
    setReorderStatus(`${title} moved to position ${idx} of ${list.length} in ${listKind}s.`);
  };

  const handleMoveDown = (defId: string, listKind: "badge" | "featured") => {
    const list = listKind === "badge" ? badgeIds : featuredIds;
    const setter = listKind === "badge" ? setBadgeIds : setFeaturedIds;
    const idx = list.indexOf(defId);
    if (idx < 0 || idx >= list.length - 1) return;
    const next = [...list];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setter(next);
    const title = eligibleByDef.get(defId)?.title ?? "Collection";
    setReorderStatus(`${title} moved to position ${idx + 2} of ${list.length} in ${listKind}s.`);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="terminal"
          size="sm"
          className="gap-2"
          onClick={openEditor}
          aria-label="Edit Trophy Case"
        >
          <Trophy className="h-3 w-3" />
          Edit Trophy Case
        </Button>
        <Button asChild variant="terminalOutline" size="sm" className="gap-2">
          <Link href="/settings" aria-label="Account Settings">
            <Settings className="h-3 w-3" />
            Settings
          </Link>
        </Button>
      </div>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-control border border-border bg-card md:max-w-xl">
          <DialogHeader>
            <DialogTitle className={S.sectionTitle}>Edit Trophy Case</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Choose up to 5 badges and 4 featured collections. Drag-free; use up/down arrows to
              reorder.
            </DialogDescription>
          </DialogHeader>
          <p className="sr-only" role="status" aria-live="polite">
            {reorderStatus}
          </p>

          {editorQuery.isLoading ? (
            <div
              className="flex items-center justify-center py-8"
              role="status"
              aria-label="Loading Trophy Case editor"
            >
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : editorQuery.isError ? (
            <div
              className="flex flex-col items-center gap-3 py-8 text-center"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle className="h-6 w-6 text-status-warning" />
              <p className="text-xs text-muted-foreground">Could not load trophy case editor.</p>
              <Button variant="terminalOutline" size="sm" onClick={() => editorQuery.refetch()}>
                <RotateCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Visibility toggle */}
              <div className="flex items-center justify-between rounded-control border border-border px-3 py-2.5">
                <div>
                  <div className="text-xs font-semibold text-content">
                    <Globe className="-mt-0.5 mr-1 inline-block h-3.5 w-3.5" />
                    Profile Visibility
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {visibility === "public"
                      ? "Anyone can see your trophy case."
                      : "Only you can see your profile."}
                  </div>
                </div>
                <Button
                  variant={visibility === "public" ? "terminal" : "terminalOutline"}
                  size="sm"
                  className="min-h-11 shrink-0 text-[10px]"
                  onClick={() => setVisibility(visibility === "public" ? "private" : "public")}
                  role="switch"
                  aria-checked={visibility === "public"}
                  aria-label="Public profile visibility"
                >
                  {visibility === "public" ? (
                    <>
                      <Globe className="h-3 w-3" />
                      Public
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3" />
                      Private
                    </>
                  )}
                </Button>
              </div>

              {/* Badges */}
              <div>
                <div className={cn(S.label, "mb-2")}>Badges ({badgeIds.length}/5)</div>
                <SelectedList
                  ids={badgeIds}
                  entries={eligibleByDef}
                  listKind="badge"
                  onRemove={(id) => handleRemove(id, "badge")}
                  onMoveUp={(id) => handleMoveUp(id, "badge")}
                  onMoveDown={(id) => handleMoveDown(id, "badge")}
                  maxCount={5}
                />
              </div>

              {/* Featured */}
              <div>
                <div className={cn(S.label, "mb-2")}>
                  Featured Collections ({featuredIds.length}/4)
                </div>
                <SelectedList
                  ids={featuredIds}
                  entries={eligibleByDef}
                  listKind="featured"
                  onRemove={(id) => handleRemove(id, "featured")}
                  onMoveUp={(id) => handleMoveUp(id, "featured")}
                  onMoveDown={(id) => handleMoveDown(id, "featured")}
                  maxCount={4}
                />
              </div>

              {/* Eligible items (collapsible) */}
              {eligibleCollections.length > 0 ? (
                <EligibleSection
                  items={eligibleCollections}
                  badgeIds={badgeIds}
                  featuredIds={featuredIds}
                  onAdd={handleAdd}
                />
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Complete a collection to make it available here.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="terminalOutline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="terminal"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || editorQuery.isLoading || editorQuery.isError}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── collapsible eligible section ─────────────────────────────────────────────

function getBadgeUnavailableReason(
  item: EligibleCollectionEntry,
  badgeIds: string[],
): string | null {
  if (badgeIds.includes(item.definitionId)) return "Already selected as badge";
  if (badgeIds.length >= 5) return "Badge limit reached (5 max)";
  if (!item.isBadgeEligible) return "Complete the current collection version";
  return null;
}

function getFeaturedUnavailableReason(
  item: EligibleCollectionEntry,
  featuredIds: string[],
): string | null {
  if (featuredIds.includes(item.definitionId)) return "Already selected as featured";
  if (featuredIds.length >= 4) return "Featured limit reached (4 max)";
  return null;
}

function EligibleSection({
  items,
  badgeIds,
  featuredIds,
  onAdd,
}: {
  items: EligibleCollectionEntry[];
  badgeIds: string[];
  featuredIds: string[];
  onAdd: (defId: string, listKind: "badge" | "featured") => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        className="flex min-h-11 w-full items-center justify-between rounded-control px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="eligible-list"
      >
        <span>Available ({items.length})</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div id="eligible-list" className="mt-2 space-y-1.5">
          {items.map((item) => {
            const badgeReason = getBadgeUnavailableReason(item, badgeIds);
            const featuredReason = getFeaturedUnavailableReason(item, featuredIds);
            const badgeDescId = `badge-reason-${item.definitionId}`;
            const featuredDescId = `featured-reason-${item.definitionId}`;

            return (
              <div
                key={item.definitionId}
                className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-content">{item.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {item.sport} {item.league} &middot; {item.season}
                  </div>
                  {badgeReason && (
                    <p id={badgeDescId} className="mt-0.5 text-[10px] text-status-warning">
                      Badge: {badgeReason.toLowerCase()}
                    </p>
                  )}
                  {featuredReason && (
                    <p id={featuredDescId} className="mt-0.5 text-[10px] text-status-warning">
                      Featured: {featuredReason.toLowerCase()}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="terminalOutline"
                    size="sm"
                    className="min-h-11 text-[10px]"
                    disabled={!!badgeReason}
                    onClick={() => onAdd(item.definitionId, "badge")}
                    aria-label={`Add ${item.title} as badge`}
                    aria-describedby={badgeReason ? badgeDescId : undefined}
                  >
                    Badge
                  </Button>
                  <Button
                    variant="terminalOutline"
                    size="sm"
                    className="min-h-11 text-[10px]"
                    disabled={!!featuredReason}
                    onClick={() => onAdd(item.definitionId, "featured")}
                    aria-label={`Add ${item.title} as featured`}
                    aria-describedby={featuredReason ? featuredDescId : undefined}
                  >
                    Feature
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── main page component ──────────────────────────────────────────────────────

export default function UserProfile() {
  const params = useParams();
  const userId = params.id as string | undefined;
  const { user } = useAuth();

  const {
    data: profile,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ProfileData>({
    queryKey: ["/api/user", userId, "profile", user?.id ?? "anonymous"],
    queryFn: async () => {
      const response = await authenticatedFetch(`/api/user/${encodeURIComponent(userId!)}/profile`);
      if (!response.ok) throw new Error(`${response.status}: Failed to load profile`);
      return response.json() as Promise<ProfileData>;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  // Loading
  if (isLoading) return <ProfileSkeleton />;

  // Error (generic — retryable), but 404 is not-found not an error
  if (isError) {
    const is404 = error instanceof Error && error.message.includes("404");
    if (is404) return <ProfileNotFound />;
    return <ProfileError onRetry={() => refetch()} />;
  }

  // No data (shouldn't happen, but handle gracefully)
  if (!profile) return <ProfileNotFound />;

  // Server returned error body or unknown shape — treat as 404
  if ("error" in (profile as any)) return <ProfileNotFound />;

  // Private profile sentinel
  if (
    "profileVisibility" in profile &&
    profile.profileVisibility === "private" &&
    !profile.isOwner
  ) {
    return <PrivateProfile />;
  }

  // Cast to public profile (the server only returns one of the two variants)
  const pub = profile as PublicProfileResponse;

  return (
    <div className="terminal-page p-3 sm:p-4">
      <PublicProfileView profile={pub} />
    </div>
  );
}
