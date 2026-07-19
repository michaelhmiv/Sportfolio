/**
 * Collection API v2 — read-layer contract for the product UI.
 *
 * Quantities are plain decimal strings (e.g. "1.0000").
 * Dates are ISO 8601 strings.  Both guarantees keep the JSON-safe rule.
 */
export type CollectionAssemblyState = "unstarted" | "in_progress" | "ready" | "active" | "inactive";

export interface CollectionListEntry {
  /** Public unique slug. */
  slug: string;

  /** Canonical definition identifier (opaque, not displayable). */
  definitionId: string;

  /** Play-code sport (e.g. "MLB", "NBA"). */
  sport: string;

  /** League abbreviation or display token. */
  league: string;

  /** Season identifier string. */
  season: string;

  /** Human-facing family group. */
  family: string;

  /** Collection kind — "player_slots" or "master". */
  kind: "player_slots" | "master";

  /** Definition lifecycle status (always "tracking" or "final" in this response). */
  lifecycleStatus: "tracking" | "final";

  // ── current version ──
  versionId: string;
  version: number;
  title: string;
  description: string;
  artKey: string;
  /** Version state (always "tracking" or "final" in this response). */
  state: "tracking" | "final";

  // ── user state (defaults to unstarted when absent) ──
  assemblyState: CollectionAssemblyState;
  allocatedQuantity: string;
  requiredQuantity: string;
  qualifiedSlotCount: number;
  requiredSlotCount: number;
  progressBps: number;

  // ── award (absent when not yet earned) ──
  award?: {
    awardId: string;
    firstCompletedAt: string; // ISO
    completionSequence: number | null;
  } | null;
}

export interface CollectionDetailResponse extends CollectionListEntry {
  qualificationDescription: string;

  /** Ordered player slots with allocation status and player display metadata. */
  slots: CollectionSlotEntry[];

  /** Ordered master prerequisites with user state for each (empty for player_slots). */
  prerequisites: CollectionPrerequisiteEntry[];
}

export interface CollectionSlotEntry {
  slotId: string;
  slotKey: string;
  slotLabel: string;
  requiredQuantity: string;
  isRequired: boolean;
  displayOrder: number;
  rank: number | null;
  statKey: string | null;
  qualificationValue: string | null;
  qualificationMetadata: Record<string, unknown> | null;
  statLabel: string | null;

  /** Active allocation for this user, or null if none. */
  allocation: {
    allocationId: string;
    allocatedQuantity: string;
    status: "active" | "released";
  } | null;

  /**
   * Exact-string maximum quantity the user can allocate to this slot
   * right now, accounting for holdings availability (excluding this
   * slot's own lock), bounded by slot requiredQuantity.  Always present
   * when player is assigned; null for vacant slots.
   */
  maxAllocatableQuantity: string | null;

  /** Total shares held across canonical player identities. */
  ownedQuantity?: string | null;

  /** Shares unavailable because another collection currently locks them. */
  lockedElsewhereQuantity?: string | null;

  /** Player display metadata, or null for vacant/unassigned slots. */
  player: {
    playerId: string;
    firstName: string;
    lastName: string;
    team: string;
    position: string;
  } | null;
}

export interface CollectionPrerequisiteEntry {
  prerequisiteId: string;
  slug: string;
  title: string;
  artKey: string;
  isRequired: boolean;
  displayOrder: number;
  isAvailable?: boolean;

  /** User state for the prerequisite collection (unstarted default if absent). */
  state: {
    assemblyState: CollectionAssemblyState;
    progressBps: number;
  };
}
