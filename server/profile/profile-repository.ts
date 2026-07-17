import { sql, eq, and, inArray, asc } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  collectionDefinitions,
  collectionDefinitionVersions,
  userCollectionAwards,
  userCollectionStates,
  userBadgePreferences,
  userFeaturedCollections,
} from "@shared/schema";

// ── profile visibility ──────────────────────────────────────────────────────

export interface ProfileRow {
  id: string;
  username: string | null;
  profileImageUrl: string | null;
  isPremium: boolean;
  premiumExpiresAt: Date | null;
  createdAt: Date;
  profileVisibility: "public" | "private";
  deletedAt: Date | null;
}

export async function getProfileRow(
  userId: string,
  executor: any = db,
): Promise<ProfileRow | undefined> {
  const [row] = await executor
    .select({
      id: users.id,
      username: users.username,
      profileImageUrl: users.profileImageUrl,
      isPremium: users.isPremium,
      premiumExpiresAt: users.premiumExpiresAt,
      createdAt: users.createdAt,
      profileVisibility: users.profileVisibility,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!row) return undefined;
  return {
    ...row,
    profileVisibility: row.profileVisibility as "public" | "private",
  };
}

// ── trophy preferences (ordered badge + featured) ───────────────────────────

export interface BadgePreferenceRow {
  collectionDefinitionId: string;
  priority: number;
}

export interface FeaturedPreferenceRow {
  collectionDefinitionId: string;
  position: number;
}

export async function getBadgePreferences(
  userId: string,
  executor: any = db,
): Promise<BadgePreferenceRow[]> {
  return executor
    .select({
      collectionDefinitionId: userBadgePreferences.collectionDefinitionId,
      priority: userBadgePreferences.priority,
    })
    .from(userBadgePreferences)
    .where(eq(userBadgePreferences.userId, userId))
    .orderBy(asc(userBadgePreferences.priority));
}

export async function getFeaturedPreferences(
  userId: string,
  executor: any = db,
): Promise<FeaturedPreferenceRow[]> {
  return executor
    .select({
      collectionDefinitionId: userFeaturedCollections.collectionDefinitionId,
      position: userFeaturedCollections.position,
    })
    .from(userFeaturedCollections)
    .where(eq(userFeaturedCollections.userId, userId))
    .orderBy(asc(userFeaturedCollections.position));
}

/** Run a public-profile read against one stable PostgreSQL snapshot. */
export async function withRepeatableRead<T>(callback: (executor: any) => Promise<T>): Promise<T> {
  return db.transaction(callback, { isolationLevel: "repeatable read" });
}

/**
 * Atomically lock the user row with FOR UPDATE, then replace visibility AND both
 * preference lists in a single transaction.  Any failure rolls back everything.
 */
export async function lockAndReplaceTrophyCase(
  userId: string,
  visibility: "public" | "private",
  badgeDefIds: string[],
  featuredDefIds: string[],
  validateAfterLock: (executor: any) => Promise<void> = async () => undefined,
): Promise<void> {
  await db.transaction(
    async (tx) => {
      // Lock the user row so no concurrent write can interleave.
      const locked = await tx.execute<{ id: string }>(
        sql`SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE`,
      );

      if (locked.rows.length === 0) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }

      const selectedDefinitionIds = [...new Set([...badgeDefIds, ...featuredDefIds])].sort();
      if (selectedDefinitionIds.length > 0) {
        // Lock the exact current definition/version/award rows in deterministic
        // order. Catalog lifecycle/version changes and award deletion must wait
        // until this transaction finishes.
        await tx.execute(sql`
        SELECT definition.id
        FROM collection_definitions definition
        JOIN collection_definition_versions version
          ON version.definition_id = definition.id
         AND version.version = definition.current_version
        JOIN user_collection_awards award
          ON award.collection_definition_id = definition.id
         AND award.collection_version_id = version.id
         AND award.user_id = ${userId}
        WHERE definition.id IN (${sql.join(
          selectedDefinitionIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        ORDER BY definition.id
        FOR SHARE OF definition, version, award
      `);
      }

      const sortedBadgeDefinitionIds = [...new Set(badgeDefIds)].sort();
      if (sortedBadgeDefinitionIds.length > 0) {
        // Badge eligibility additionally depends on mutable per-user state.
        await tx.execute(sql`
        SELECT state.collection_definition_id
        FROM user_collection_states state
        WHERE state.user_id = ${userId}
          AND state.collection_definition_id IN (${sql.join(
            sortedBadgeDefinitionIds.map((id) => sql`${id}`),
            sql`, `,
          )})
        ORDER BY state.collection_definition_id
        FOR SHARE OF state
      `);
      }

      // Repeat validation using this same transaction/connection after all
      // eligibility rows are locked.
      await validateAfterLock(tx);

      // Update visibility.
      await tx.update(users).set({ profileVisibility: visibility }).where(eq(users.id, userId));

      // Replace badge preferences.
      await tx.delete(userBadgePreferences).where(eq(userBadgePreferences.userId, userId));

      if (badgeDefIds.length > 0) {
        await tx.insert(userBadgePreferences).values(
          badgeDefIds.map((defId, i) => ({
            userId,
            collectionDefinitionId: defId,
            priority: i,
          })),
        );
      }

      // Replace featured preferences.
      await tx.delete(userFeaturedCollections).where(eq(userFeaturedCollections.userId, userId));

      if (featuredDefIds.length > 0) {
        await tx.insert(userFeaturedCollections).values(
          featuredDefIds.map((defId, i) => ({
            userId,
            collectionDefinitionId: defId,
            position: i,
          })),
        );
      }
    },
    { isolationLevel: "serializable" },
  );
}

// ── award + definition + state lookups ──────────────────────────────────────

export interface AwardWithDefinitionAndStateRow {
  definitionId: string;
  versionId: string;
  firstCompletedAt: Date;
  completionSequence: number | null;
  // definition
  slug: string;
  sport: string;
  league: string;
  season: string;
  family: string;
  kind: string;
  lifecycleStatus: string;
  // current version
  version: number;
  title: string;
  artKey: string;
  state: string;
  // user state for the current version
  assemblyState: string | null;
}

/**
 * Returns all of a user's awards joined with the current-version definition
 * AND the user's collection state for that version (so we can check active).
 */
export async function getAwardsWithDefinitionsAndStates(
  userId: string,
  executor: any = db,
): Promise<AwardWithDefinitionAndStateRow[]> {
  const rows = await executor
    .select({
      definitionId: userCollectionAwards.collectionDefinitionId,
      versionId: userCollectionAwards.collectionVersionId,
      firstCompletedAt: userCollectionAwards.firstCompletedAt,
      completionSequence: userCollectionAwards.completionSequence,
      slug: collectionDefinitions.slug,
      sport: collectionDefinitions.sport,
      league: collectionDefinitions.league,
      season: collectionDefinitions.season,
      family: collectionDefinitions.family,
      kind: collectionDefinitions.kind,
      lifecycleStatus: collectionDefinitions.lifecycleStatus,
      version: collectionDefinitionVersions.version,
      title: collectionDefinitionVersions.title,
      artKey: collectionDefinitionVersions.artKey,
      state: collectionDefinitionVersions.state,
      assemblyState: userCollectionStates.assemblyState,
    })
    .from(userCollectionAwards)
    .innerJoin(
      collectionDefinitions,
      eq(collectionDefinitions.id, userCollectionAwards.collectionDefinitionId),
    )
    .innerJoin(
      collectionDefinitionVersions,
      and(
        eq(collectionDefinitionVersions.id, userCollectionAwards.collectionVersionId),
        eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
        eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
      ),
    )
    .leftJoin(
      userCollectionStates,
      and(
        eq(userCollectionStates.userId, userCollectionAwards.userId),
        eq(userCollectionStates.collectionVersionId, collectionDefinitionVersions.id),
      ),
    )
    .where(eq(userCollectionAwards.userId, userId));

  return rows as AwardWithDefinitionAndStateRow[];
}

/**
 * Check that a set of definition IDs exist, are in a publicly visible
 * lifecycle (tracking/final), and are not disabled. Returns the set of
 * definition IDs that pass all checks.
 */
export async function getPubliclyVisibleDefinitions(
  definitionIds: string[],
  executor: any = db,
): Promise<Set<string>> {
  if (definitionIds.length === 0) return new Set();

  const rows = await executor
    .select({ id: collectionDefinitions.id })
    .from(collectionDefinitions)
    .innerJoin(
      collectionDefinitionVersions,
      and(
        eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
        eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
      ),
    )
    .where(
      and(
        inArray(collectionDefinitions.id, definitionIds),
        sql`${collectionDefinitions.lifecycleStatus} IN ('tracking', 'final')`,
        sql`${collectionDefinitionVersions.state} IN ('tracking', 'final')`,
      ),
    );

  return new Set(rows.map((r: { id: string }) => r.id));
}
