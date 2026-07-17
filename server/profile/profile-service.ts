import type {
  PublicProfileResponse,
  PrivateProfileSentinel,
  PublicBadgeEntry,
  PublicFeaturedEntry,
  TrophyCollectionIdentity,
  TrophyCaseEditorResponse,
  TrophyCaseEditorRequest,
  TrophyCaseValidationError,
  EligibleCollectionEntry,
} from "@shared/trophy-case";
import {
  getProfileRow,
  getBadgePreferences,
  getFeaturedPreferences,
  getAwardsWithDefinitionsAndStates,
  getPubliclyVisibleDefinitions,
  lockAndReplaceTrophyCase,
  withRepeatableRead,
  type ProfileRow,
  type AwardWithDefinitionAndStateRow,
} from "./profile-repository";

// ── helpers ──────────────────────────────────────────────────────────────────

const MAX_BADGES = 5;
const MAX_FEATURED = 4;

function iso(date: Date | string | null): string {
  if (!date) return new Date().toISOString();
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

function toIdentity(row: AwardWithDefinitionAndStateRow): TrophyCollectionIdentity {
  return {
    slug: row.slug,
    definitionId: row.definitionId,
    sport: row.sport,
    league: row.league,
    season: row.season,
    family: row.family,
    kind: row.kind as "player_slots" | "master",
    title: row.title,
    artKey: row.artKey,
    lifecycleStatus: row.lifecycleStatus as "tracking" | "final",
  };
}

/** True iff premium flag is true and expiry is null or in the future. */
function isPremiumActive(row: ProfileRow): boolean {
  if (!row.isPremium) return false;
  if (!row.premiumExpiresAt) return true;
  return row.premiumExpiresAt.getTime() > Date.now();
}

function isPubliclyVisible(award: AwardWithDefinitionAndStateRow): boolean {
  const lifecycle = award.lifecycleStatus;
  if (lifecycle !== "tracking" && lifecycle !== "final") return false;
  const state = award.state;
  if (state !== "tracking" && state !== "final") return false;
  return true;
}

/**
 * Badge eligible = all of:
 * 1. Definition lifecycle is tracking/final (isPubliclyVisible)
 * 2. Current version state is tracking/final
 * 3. A matching immutable award exists (caller ensures this)
 * 4. user_collection_states.assembly_state = 'active'
 */
function isBadgeEligible(award: AwardWithDefinitionAndStateRow): boolean {
  if (!isPubliclyVisible(award)) return false;
  return award.assemblyState === "active";
}

// ── public profile (includes trophy case when visible) ──────────────────────

export interface PublicProfileService {
  getPublicProfile(
    requestedUserId: string,
    viewerUserId: string | null,
  ): Promise<PublicProfileResponse | PrivateProfileSentinel>;
}

export class PostgresPublicProfileService implements PublicProfileService {
  constructor(private readonly trophyService: PublicTrophyService) {}

  async getPublicProfile(
    requestedUserId: string,
    viewerUserId: string | null,
  ): Promise<PublicProfileResponse | PrivateProfileSentinel> {
    return withRepeatableRead(async (executor) => {
      const profile = await getProfileRow(requestedUserId, executor);

      if (!profile || profile.deletedAt) {
        const error: any = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }

      const isOwner = viewerUserId === requestedUserId;

      if (profile.profileVisibility === "private" && !isOwner) {
        return {
          profileVisibility: "private",
          isOwner: false,
        };
      }

      const { badges, featured } = await this.trophyService.getPublicTrophyCase(
        requestedUserId,
        executor,
      );

      return {
        id: profile.id,
        username: profile.username,
        profileImageUrl: profile.profileImageUrl,
        isPremium: isPremiumActive(profile),
        createdAt: iso(profile.createdAt),
        profileVisibility: profile.profileVisibility,
        isOwner,
        badges,
        featured,
      };
    });
  }
}

// ── public trophy display ───────────────────────────────────────────────────

export interface PublicTrophyService {
  getPublicTrophyCase(
    userId: string,
    executor?: any,
  ): Promise<{ badges: PublicBadgeEntry[]; featured: PublicFeaturedEntry[] }>;
}

export class PostgresPublicTrophyService implements PublicTrophyService {
  async getPublicTrophyCase(userId: string, executor?: any) {
    const [badgePrefs, featuredPrefs, awards] = await Promise.all([
      getBadgePreferences(userId, executor),
      getFeaturedPreferences(userId, executor),
      getAwardsWithDefinitionsAndStates(userId, executor),
    ]);

    // Only visible awards count.
    const awardByDef = new Map<string, AwardWithDefinitionAndStateRow>();
    for (const a of awards) {
      if (isPubliclyVisible(a)) {
        awardByDef.set(a.definitionId, a);
      }
    }

    // Badges: selected preference → matching immutable award → public lifecycle → active state.
    const badges: PublicBadgeEntry[] = [];
    for (const pref of badgePrefs.slice(0, MAX_BADGES)) {
      const award = awardByDef.get(pref.collectionDefinitionId);
      if (!award) continue;
      if (!isBadgeEligible(award)) continue;
      badges.push({
        definitionId: award.definitionId,
        collection: toIdentity(award),
        earnedAt: iso(award.firstCompletedAt),
      });
    }

    // Featured: selected preference → immutable award → public lifecycle → ordered.
    const featured: PublicFeaturedEntry[] = [];
    for (const pref of featuredPrefs.slice(0, MAX_FEATURED)) {
      const award = awardByDef.get(pref.collectionDefinitionId);
      if (!award) continue;
      featured.push({
        definitionId: award.definitionId,
        collection: toIdentity(award),
        earnedAt: iso(award.firstCompletedAt),
      });
    }

    return { badges, featured };
  }
}

// ── trophy case editor ──────────────────────────────────────────────────────

export interface TrophyCaseEditorService {
  getEditorState(userId: string): Promise<TrophyCaseEditorResponse>;
  updateTrophyCase(
    userId: string,
    request: TrophyCaseEditorRequest,
  ): Promise<TrophyCaseEditorResponse>;
}

export class PostgresTrophyCaseEditorService implements TrophyCaseEditorService {
  constructor(private readonly trophyService: PublicTrophyService) {}

  async getEditorState(userId: string): Promise<TrophyCaseEditorResponse> {
    const { profile, badgePrefs, featuredPrefs, awards } = await withRepeatableRead(
      async (executor) => {
        const [profile, badgePrefs, featuredPrefs, awards] = await Promise.all([
          getProfileRow(userId, executor),
          getBadgePreferences(userId, executor),
          getFeaturedPreferences(userId, executor),
          getAwardsWithDefinitionsAndStates(userId, executor),
        ]);
        return { profile, badgePrefs, featuredPrefs, awards };
      },
    );

    if (!profile || profile.deletedAt) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }

    // Only publicly visible awards are eligible for selection.
    const eligible: EligibleCollectionEntry[] = awards
      .filter((a) => isPubliclyVisible(a))
      .map((a) => ({
        definitionId: a.definitionId,
        slug: a.slug,
        sport: a.sport,
        league: a.league,
        season: a.season,
        family: a.family,
        title: a.title,
        artKey: a.artKey,
        lifecycleStatus: a.lifecycleStatus as "tracking" | "final",
        earnedAt: iso(a.firstCompletedAt),
        completionSequence: a.completionSequence ?? null,
        isBadgeEligible: isBadgeEligible(a),
      }));

    const eligibleByDefinitionId = new Map(eligible.map((entry) => [entry.definitionId, entry]));

    return {
      profileVisibility: (profile?.profileVisibility ?? "public") as "public" | "private",
      badgeDefinitionIds: badgePrefs
        .map((preference) => preference.collectionDefinitionId)
        .filter((definitionId) => eligibleByDefinitionId.get(definitionId)?.isBadgeEligible)
        .slice(0, MAX_BADGES),
      featuredDefinitionIds: featuredPrefs
        .map((preference) => preference.collectionDefinitionId)
        .filter((definitionId) => eligibleByDefinitionId.has(definitionId))
        .slice(0, MAX_FEATURED),
      eligibleCollections: eligible,
    };
  }

  async updateTrophyCase(
    userId: string,
    request: TrophyCaseEditorRequest,
  ): Promise<TrophyCaseEditorResponse> {
    const assertValid = async (executor?: any): Promise<void> => {
      const errors = await validateTrophyCaseRequest(userId, request, executor);
      if (errors.length > 0) {
        const validationError: any = new Error("Trophy case validation failed");
        validationError.statusCode = 422;
        validationError.errors = errors;
        throw validationError;
      }
    };

    // Fail fast before waiting on a lock, then repeat after lock acquisition so
    // stale eligibility cannot be persisted by a delayed concurrent request.
    await assertValid();

    // One atomic transaction: lock user row, revalidate, update visibility,
    // and replace both lists.
    await lockAndReplaceTrophyCase(
      userId,
      request.profileVisibility,
      request.badgeDefinitionIds,
      request.featuredDefinitionIds,
      assertValid,
    );

    return this.getEditorState(userId);
  }
}

// ── validation ──────────────────────────────────────────────────────────────

async function validateTrophyCaseRequest(
  userId: string,
  request: TrophyCaseEditorRequest,
  executor?: any,
): Promise<TrophyCaseValidationError[]> {
  const errors: TrophyCaseValidationError[] = [];

  // Visibility
  if (request.profileVisibility !== "public" && request.profileVisibility !== "private") {
    errors.push({
      code: "INVALID_VISIBILITY",
      message: 'profileVisibility must be "public" or "private"',
    });
  }

  // Max counts
  if (request.badgeDefinitionIds.length > MAX_BADGES) {
    errors.push({
      code: "MAX_BADGES_EXCEEDED",
      message: `Maximum ${MAX_BADGES} badges allowed`,
      details: { max: MAX_BADGES, received: request.badgeDefinitionIds.length },
    });
  }

  if (request.featuredDefinitionIds.length > MAX_FEATURED) {
    errors.push({
      code: "MAX_FEATURED_EXCEEDED",
      message: `Maximum ${MAX_FEATURED} featured collections allowed`,
      details: { max: MAX_FEATURED, received: request.featuredDefinitionIds.length },
    });
  }

  // Uniqueness within each list
  {
    const badgeSet = new Set(request.badgeDefinitionIds);
    if (badgeSet.size !== request.badgeDefinitionIds.length) {
      errors.push({
        code: "DUPLICATE_BADGE_DEFINITIONS",
        message: "Badge definition IDs must be unique",
      });
    }
  }

  {
    const featuredSet = new Set(request.featuredDefinitionIds);
    if (featuredSet.size !== request.featuredDefinitionIds.length) {
      errors.push({
        code: "DUPLICATE_FEATURED_DEFINITIONS",
        message: "Featured collection definition IDs must be unique",
      });
    }
  }

  // Early exit if basic validation fails — skip DB checks.
  if (errors.length > 0) return errors;

  // Verify all referenced definition IDs exist and are publicly visible.
  const allDefIds = [...request.badgeDefinitionIds, ...request.featuredDefinitionIds];
  if (allDefIds.length > 0) {
    const visibleSet = await getPubliclyVisibleDefinitions(allDefIds, executor);

    for (const defId of request.badgeDefinitionIds) {
      if (!visibleSet.has(defId)) {
        errors.push({
          code: "BADGE_DEFINITION_NOT_FOUND",
          message: `Badge definition ${defId} was not found or is not publicly visible`,
          details: { definitionId: defId },
        });
      }
    }

    for (const defId of request.featuredDefinitionIds) {
      if (!visibleSet.has(defId)) {
        errors.push({
          code: "FEATURED_DEFINITION_NOT_FOUND",
          message: `Featured definition ${defId} was not found or is not publicly visible`,
          details: { definitionId: defId },
        });
      }
    }
  }

  if (errors.length > 0) return errors;

  // Verify award ownership + eligibility (using states for badge active check).
  const awards = await getAwardsWithDefinitionsAndStates(userId, executor);
  const awardByDef = new Map<string, AwardWithDefinitionAndStateRow>();
  for (const a of awards) {
    awardByDef.set(a.definitionId, a);
  }

  for (const defId of request.badgeDefinitionIds) {
    const award = awardByDef.get(defId);
    if (!award) {
      errors.push({
        code: "BADGE_NOT_EARNED",
        message: `You haven't earned the badge for definition ${defId}`,
        details: { definitionId: defId },
      });
    } else if (!isBadgeEligible(award)) {
      errors.push({
        code: "BADGE_NOT_ELIGIBLE",
        message: `The collection for definition ${defId} is not eligible as a badge`,
        details: {
          definitionId: defId,
          lifecycleStatus: award.lifecycleStatus,
          versionState: award.state,
          assemblyState: award.assemblyState,
        },
      });
    }
  }

  for (const defId of request.featuredDefinitionIds) {
    if (!awardByDef.has(defId)) {
      errors.push({
        code: "FEATURED_NOT_EARNED",
        message: `You haven't earned the collection for definition ${defId}`,
        details: { definitionId: defId },
      });
    }
  }

  return errors;
}
