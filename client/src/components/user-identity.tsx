import { useState, useCallback, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PublicUserIdentity } from "@shared/public-user-identity";
import { CollectionArt } from "./collection-art";

// ── types ────────────────────────────────────────────────────────────────────

export type UserIdentityVariant =
  | "micro"
  | "compact"
  | "ranked"
  | "featured"
  | "profile";

export interface UserIdentityProps {
  variant: UserIdentityVariant;
  identity: PublicUserIdentity | null;
  rank?: number;
  className?: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function initials(username: string | null): string {
  return (username || "").slice(0, 2).toUpperCase() || "??";
}

function displayName(username: string | null): string {
  return username ? `@${username}` : "Unknown User";
}

// ── size configs ─────────────────────────────────────────────────────────────

const AVATAR_SIZES: Record<UserIdentityVariant, string> = {
  micro: "h-6 w-6",
  compact: "h-9 w-9",
  ranked: "h-9 w-9",
  featured: "h-9 w-9",
  profile: "h-16 w-16 sm:h-20 sm:w-20",
};

const FALLBACK_SIZES: Record<UserIdentityVariant, string> = {
  micro: "text-[8px]",
  compact: "text-xs",
  ranked: "text-xs",
  featured: "text-xs",
  profile: "text-lg sm:text-xl",
};

// ── badge pin ────────────────────────────────────────────────────────────────

function BadgePin({ identity }: { identity: PublicUserIdentity }) {
  if (!identity.activeBadge) return null;
  return (
    <div
      data-testid="badge-pin"
      className="absolute -bottom-1 -right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-amber-500"
      aria-label={`Badge: ${identity.activeBadge.title}`}
    >
      <div className="h-2 w-2 rounded-full bg-white" />
    </div>
  );
}

// ── badge frame ──────────────────────────────────────────────────────────────

function BadgeFrame({
  children,
  identity,
}: {
  children: React.ReactNode;
  identity: PublicUserIdentity;
}) {
  if (!identity.activeBadge) return <>{children}</>;
  return (
    <div
      data-testid="badge-frame"
      className="relative inline-block rounded-full p-[2px] bg-gradient-to-br from-amber-400 to-amber-600"
    >
      <div className="rounded-full bg-background p-[1px]">{children}</div>
    </div>
  );
}

// ── premium crown ────────────────────────────────────────────────────────────

function PremiumCrown({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      data-testid="premium-crown"
      className="ml-1 inline-flex items-center text-amber-500"
      aria-label="Premium member"
      title="Premium member"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 2v2H5v-2h14z" />
      </svg>
    </span>
  );
}

// ── expanded identity card (popover content) ─────────────────────────────────

function IdentityCard({ identity }: { identity: PublicUserIdentity }) {
  return (
    <div
      data-testid="identity-popover"
      className="flex flex-col gap-3 min-w-[200px]"
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12">
          <AvatarImage
            src={identity.avatarUrl || undefined}
            alt={displayName(identity.username)}
          />
          <AvatarFallback className="text-sm">
            {initials(identity.username)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate text-sm font-semibold text-content">
            {displayName(identity.username)}
            <PremiumCrown show={identity.premiumActive} />
          </div>
          {identity.activeBadge && (
            <div className="text-xs text-muted-foreground">
              {identity.activeBadge.title}
            </div>
          )}
        </div>
      </div>

      {/* Badge detail */}
      {identity.activeBadge && (
        <div className="flex items-center gap-2 rounded-control border border-border bg-surface px-2 py-1.5">
          <CollectionArt
            artKey={identity.activeBadge.artKey}
            sport={identity.activeBadge.sport}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">
              {identity.activeBadge.title}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {identity.activeBadge.sport} &middot; {identity.activeBadge.season}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── avatar block (shared across variants) ────────────────────────────────────

function AvatarBlock({
  identity,
  variant,
}: {
  identity: PublicUserIdentity;
  variant: UserIdentityVariant;
}) {
  return (
    <Avatar
      className={cn(AVATAR_SIZES[variant], "shrink-0")}
      data-testid="avatar-fallback-container"
    >
      <AvatarImage
        src={identity.avatarUrl || undefined}
        alt={displayName(identity.username)}
      />
      <AvatarFallback
        className={cn(FALLBACK_SIZES[variant])}
        data-testid="avatar-fallback"
      >
        {initials(identity.username)}
      </AvatarFallback>
    </Avatar>
  );
}

// ── micro variant (avatar + badge pin, 24px) ─────────────────────────────────

function MicroIdentity({ identity }: { identity: PublicUserIdentity }) {
  return (
    <div className="relative inline-block">
      <AvatarBlock identity={identity} variant="micro" />
      <BadgePin identity={identity} />
    </div>
  );
}

// ── compact variant (avatar + frame + pin + username, 36px) ──────────────────

function CompactIdentity({ identity }: { identity: PublicUserIdentity }) {
  return (
    <div className="flex items-center gap-2">
      <BadgeFrame identity={identity}>
        <div className="relative">
          <AvatarBlock identity={identity} variant="compact" />
          <BadgePin identity={identity} />
        </div>
      </BadgeFrame>
      <span
        data-testid="username-display"
        className="text-sm font-medium text-content truncate"
      >
        {displayName(identity.username)}
        <PremiumCrown show={identity.premiumActive} />
      </span>
    </div>
  );
}

// ── ranked variant (compact + rank number) ───────────────────────────────────

function RankedIdentity({
  identity,
  rank,
}: {
  identity: PublicUserIdentity;
  rank?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        data-testid="rank-number"
        className="w-5 text-center text-sm font-bold text-muted-foreground tabular-nums shrink-0"
      >
        {rank ?? "—"}
      </span>
      <BadgeFrame identity={identity}>
        <div className="relative">
          <AvatarBlock identity={identity} variant="ranked" />
          <BadgePin identity={identity} />
        </div>
      </BadgeFrame>
      <span
        data-testid="username-display"
        className="text-sm font-medium text-content truncate"
      >
        {displayName(identity.username)}
        <PremiumCrown show={identity.premiumActive} />
      </span>
    </div>
  );
}

// ── featured variant (compact + featured border) ─────────────────────────────

function FeaturedIdentity({ identity }: { identity: PublicUserIdentity }) {
  return (
    <div
      data-testid="featured-identity"
      className="flex items-center gap-2 rounded-control border-2 border-amber-500/40 bg-amber-500/5 px-3 py-2"
    >
      <BadgeFrame identity={identity}>
        <div className="relative">
          <AvatarBlock identity={identity} variant="featured" />
          <BadgePin identity={identity} />
        </div>
      </BadgeFrame>
      <span
        data-testid="username-display"
        className="text-sm font-medium text-content truncate"
      >
        {displayName(identity.username)}
        <PremiumCrown show={identity.premiumActive} />
      </span>
    </div>
  );
}

// ── profile variant (large avatar + frame + pin + username + premium + badge) ─

function ProfileIdentity({ identity }: { identity: PublicUserIdentity }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <BadgeFrame identity={identity}>
        <div className="relative">
          <AvatarBlock identity={identity} variant="profile" />
          <BadgePin identity={identity} />
        </div>
      </BadgeFrame>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <h2
            data-testid="username-display"
            className="text-lg font-bold text-content truncate"
          >
            {displayName(identity.username)}
          </h2>
          <PremiumCrown show={identity.premiumActive} />
        </div>

        {identity.activeBadge && (
          <div
            data-testid="badge-detail"
            className="mt-2 flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2"
          >
            <CollectionArt
              artKey={identity.activeBadge.artKey}
              sport={identity.activeBadge.sport}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {identity.activeBadge.title}
              </div>
              <div className="text-xs text-muted-foreground">
                {identity.activeBadge.sport} {identity.activeBadge.league} &middot;{" "}
                {identity.activeBadge.season}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── fallback for null identity ───────────────────────────────────────────────

function FallbackIdentity() {
  return (
    <div
      data-testid="identity-fallback"
      className="flex items-center gap-2 text-muted-foreground"
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="text-xs">??</AvatarFallback>
      </Avatar>
      <span className="text-sm">Unknown User</span>
    </div>
  );
}

// ── render switch ────────────────────────────────────────────────────────────

function IdentityContent({
  variant,
  identity,
  rank,
}: {
  variant: UserIdentityVariant;
  identity: PublicUserIdentity;
  rank?: number;
}) {
  switch (variant) {
    case "micro":
      return <MicroIdentity identity={identity} />;
    case "compact":
      return <CompactIdentity identity={identity} />;
    case "ranked":
      return <RankedIdentity identity={identity} rank={rank} />;
    case "featured":
      return <FeaturedIdentity identity={identity} />;
    case "profile":
      return <ProfileIdentity identity={identity} />;
    default:
      return <CompactIdentity identity={identity} />;
  }
}

// ── main component ───────────────────────────────────────────────────────────

export function UserIdentity({
  variant,
  identity,
  rank,
  className,
}: UserIdentityProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [],
  );

  if (!identity) {
    return <FallbackIdentity />;
  }

  const trigger = (
    <span
      ref={triggerRef}
      data-testid="identity-trigger"
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-expanded={open}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-block cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm",
        "motion-safe:transition-opacity",
        className,
      )}
    >
      <IdentityContent variant={variant} identity={identity} rank={rank} />
    </span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <IdentityCard identity={identity} />
      </PopoverContent>
    </Popover>
  );
}
