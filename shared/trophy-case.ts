/**
 * Trophy Case — public and editor contracts.
 *
 * These types are intentionally minimal: they expose only data the user
 * has explicitly chosen to share, and never leak allocation/lock/progress
 * or raw preference row IDs.
 */

/** Public profile identity allowlist — what anyone can see. */
export interface PublicProfileResponse {
  id: string;
  username: string | null;
  profileImageUrl: string | null;
  isPremium: boolean;
  createdAt: string; // ISO
  profileVisibility: "public" | "private";
  isOwner: boolean;
  /** Ordered selected-only public badges. Absent when profile is private. */
  badges: PublicBadgeEntry[];
  /** Ordered selected-only public featured collections. Absent when profile is private. */
  featured: PublicFeaturedEntry[];
}

/** Builder-only sentinel returned when profile is private and viewer != owner. */
export interface PrivateProfileSentinel {
  profileVisibility: "private";
  isOwner: false;
}

/** Safe public identity for an awarded collection (badge or featured). */
export interface TrophyCollectionIdentity {
  slug: string;
  definitionId: string;
  sport: string;
  league: string;
  season: string;
  family: string;
  kind: "player_slots" | "master";
  title: string;
  artKey: string;
  lifecycleStatus: "tracking" | "final";
}

/** Public badge display entry. */
export interface PublicBadgeEntry {
  definitionId: string;
  collection: TrophyCollectionIdentity;
  /** ISO; when the award was first earned. */
  earnedAt: string;
}

/** Public featured collection display entry. */
export interface PublicFeaturedEntry {
  definitionId: string;
  collection: TrophyCollectionIdentity;
  earnedAt: string;
}

/** Safe selected-only trophy case embedded in a visible public profile. */
export interface PublicTrophyCaseResponse {
  badges: PublicBadgeEntry[];
  featured: PublicFeaturedEntry[];
}

// ── editor contracts ────────────────────────────────────────────────────────

/** An eligible awarded collection shown in the trophy-case editor. */
export interface EligibleCollectionEntry {
  definitionId: string;
  slug: string;
  sport: string;
  league: string;
  season: string;
  family: string;
  title: string;
  artKey: string;
  points: number;
  lifecycleStatus: "tracking" | "final";
  /** When the award was earned (ISO). */
  earnedAt: string;
  completionSequence: number | null;
  /** Whether this collection is currently eligible as a badge (active state). */
  isBadgeEligible: boolean;
}

/** GET /api/me/trophy-case response. */
export interface TrophyCaseEditorResponse {
  profileVisibility: "public" | "private";
  /** Ordered definition IDs for badge preferences (0-5). */
  badgeDefinitionIds: string[];
  /** Ordered definition IDs for featured preferences (0-4). */
  featuredDefinitionIds: string[];
  /** All awarded collections eligible for selection. */
  eligibleCollections: EligibleCollectionEntry[];
}

/** PUT /api/me/trophy-case request body. */
export interface TrophyCaseEditorRequest {
  profileVisibility: "public" | "private";
  badgeDefinitionIds: string[];
  featuredDefinitionIds: string[];
}

/** Structured validation error returned by PUT /api/me/trophy-case. */
export interface TrophyCaseValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
