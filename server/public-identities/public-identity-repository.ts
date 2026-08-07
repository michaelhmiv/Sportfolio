import { and, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { pool } from "../db";
import { users } from "@shared/schema";
import type { PublicUserIdentity, PublicBadgeIdentity } from "@shared/public-user-identity";
import { resolveUserEntitlements } from "../services/user-entitlements";

export interface PublicIdentityRepository {
  resolveIdentities(userIds: string[]): Promise<(PublicUserIdentity | null)[]>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ── batch query types ──────────────────────────────────────────────────────

interface UserRow {
  id: string;
  username: string | null;
  profileImageUrl: string | null;
  isPremium: boolean;
  premiumExpiresAt: Date | null;
  profileVisibility: string;
  deletedAt: Date | null;
}

interface BadgeRow {
  userId: string;
  definitionId: string;
  versionId: string;
  slug: string;
  title: string;
  artKey: string;
  sport: string;
  league: string;
  season: string;
  family: string;
  firstCompletedAt: string;
}

// ── implementation ──────────────────────────────────────────────────────────

export class PostgresPublicIdentityRepository implements PublicIdentityRepository {
  async resolveIdentities(userIds: string[]): Promise<(PublicUserIdentity | null)[]> {
    if (userIds.length === 0) return [];

    // Deduplicate deterministically (first-occurrence order).
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const id of userIds) {
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(id);
      }
    }

    // ── One set-based query for users ──────────────────────────────────────
    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        profileImageUrl: users.profileImageUrl,
        isPremium: users.isPremium,
        premiumExpiresAt: users.premiumExpiresAt,
        profileVisibility: users.profileVisibility,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(and(inArray(users.id, deduped), sql`${users.deletedAt} IS NULL`));

    const userById = new Map<string, UserRow>();
    for (const row of userRows) {
      userById.set(row.id, row);
    }

    // Only resolve badges for users that exist.
    const existingIds = Array.from(userById.keys());
    const badgeByUserId = new Map<string, BadgeRow>();

    if (existingIds.length > 0) {
      // ── One set-based query for active badges ────────────────────────────
      //
      // For each user:
      // 1. Take the first preferred badge from user_badge_preferences (by priority)
      // 2. That has an immutable award (user_collection_awards)
      // 3. Where the award's version matches the definition's current_version
      // 4. Definition lifecycle is tracking/final
      // 5. Version state is tracking/final
      // 6. User's collection state is active
      //
      // Uses DISTINCT ON (user_id) with ORDER BY priority to get exactly one row per user.
      const idPlaceholders = existingIds.map((_, i) => `$${i + 1}`);
      const result = await pool.query(
        `SELECT DISTINCT ON (p.user_id)
          p.user_id AS "userId",
          d.id AS "definitionId",
          v.id AS "versionId",
          d.slug,
          v.title,
          v.art_key AS "artKey",
          d.sport,
          d.league,
          d.season,
          d.family,
          a.first_completed_at AS "firstCompletedAt"
        FROM user_badge_preferences p
        JOIN user_collection_awards a
          ON a.user_id = p.user_id
         AND a.collection_definition_id = p.collection_definition_id
        JOIN collection_definitions d
          ON d.id = a.collection_definition_id
        JOIN collection_definition_versions v
          ON v.id = a.collection_version_id
         AND v.definition_id = d.id
         AND v.version = d.current_version
        JOIN user_collection_states s
          ON s.user_id = p.user_id
         AND s.collection_version_id = v.id
        WHERE p.user_id IN (${idPlaceholders.join(", ")})
          AND d.lifecycle_status IN ('tracking', 'final')
          AND v.state IN ('tracking', 'final')
          AND s.assembly_state = 'active'
        ORDER BY p.user_id, p.priority ASC`,
        existingIds,
      );

      for (const row of result.rows as BadgeRow[]) {
        if (!badgeByUserId.has(row.userId)) {
          badgeByUserId.set(row.userId, row);
        }
      }
    }

    // ── Map results back in deduplicated request order ────────────────────
    return deduped.map((id) => {
      const user = userById.get(id);
      if (!user) return null;

      // profile_visibility=private suppresses activeBadge
      let activeBadge: PublicBadgeIdentity | null = null;
      if (user.profileVisibility !== "private") {
        const badge = badgeByUserId.get(id);
        if (badge) {
          activeBadge = {
            definitionId: badge.definitionId,
            versionId: badge.versionId,
            slug: badge.slug,
            title: badge.title,
            artKey: badge.artKey,
            sport: badge.sport,
            league: badge.league,
            season: badge.season,
            family: badge.family,
            firstCompletedAt: badge.firstCompletedAt,
          };
        }
      }

      const entitlements = resolveUserEntitlements({
        id: user.id,
        isPremium: user.isPremium,
        premiumExpiresAt: user.premiumExpiresAt,
      });

      return {
        userId: user.id,
        username: user.username,
        avatarUrl: user.profileImageUrl,
        premiumActive: entitlements.premiumActive,
        activeBadge,
      };
    });
  }
}

export const publicIdentityRepository = new PostgresPublicIdentityRepository();
