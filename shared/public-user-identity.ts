/**
 * Public User Identity — canonical shared contract for batch identity resolution.
 *
 * This is the public, recursive-only allowlist of what anyone can see about a
 * user.  Nothing from this type may leak allocations, locks, progress,
 * preference-row IDs, or any other internal state.
 */
export interface PublicBadgeIdentity {
  definitionId: string;
  versionId: string;
  slug: string;
  title: string;
  artKey: string;
  sport: string;
  league: string;
  season: string;
  family: string;
  /** ISO 8601 — when the award was first earned. */
  firstCompletedAt: string;
}

export interface PublicUserIdentity {
  userId: string;
  username: string | null;
  /** Nullable avatar URL. */
  avatarUrl: string | null;
  /** Resolved via pure resolveUserEntitlements semantics (no writes). */
  premiumActive: boolean;
  /**
   * First preferred eligible exact-current-version award with active state and
   * tracking/final definition+version.  Suppressed when profile_visibility is
   * private.
   */
  activeBadge: PublicBadgeIdentity | null;
}

export interface PublicIdentityBatchRequest {
  /** Deduplicated, trimmed, non-blank user IDs.  Max 100 unique after dedupe. */
  userIds: string[];
}

export interface PublicIdentityBatchResponse {
  /**
   * Deterministically ordered to match the deduplicated request.  Null for
   * users that do not exist or have been soft-deleted.
   */
  identities: (PublicUserIdentity | null)[];
}
