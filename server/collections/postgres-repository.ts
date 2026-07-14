import {
  collectionDefinitionVersions,
  collectionDefinitions,
  collectionPrerequisites,
  collectionSlots,
  holdings,
  holdingsLocks,
  userCollectionAllocations,
  userCollectionAwards,
  userCollectionStateEvents,
  userCollectionStates,
} from "@shared/schema";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { loadPlayerIdentityContext } from "../player-identity";
import {
  CollectionDomainError,
  compareCollectionQuantities,
  type CollectionProgressSnapshot,
} from "./state-engine";
import type {
  CollectionAllocationRecord,
  CollectionAwardRecord,
  CollectionDefinitionContext,
  CollectionRepository,
  CollectionReconciliationCandidate,
  CollectionSlotContext,
  CollectionStateEventInput,
  CollectionTransaction,
  EarnedBadgePreference,
} from "./service";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function mapDefinition(row: {
  definitionId: string;
  slug: string;
  kind: string;
  lifecycleStatus: string;
  currentVersion: number;
  versionId: string;
  version: number;
  versionState: string;
}): CollectionDefinitionContext {
  return {
    ...row,
    kind: row.kind === "master" ? "master" : "player_slots",
  };
}

function mapState(row: typeof userCollectionStates.$inferSelect): CollectionProgressSnapshot {
  return {
    assemblyState: row.assemblyState as CollectionProgressSnapshot["assemblyState"],
    allocatedQuantity: row.allocatedQuantity,
    requiredQuantity: row.requiredQuantity,
    qualifiedSlotCount: row.qualifiedSlotCount,
    requiredSlotCount: row.requiredSlotCount,
    progressBps: row.progressBps,
    readyAt: row.readyAt,
    activatedAt: row.activatedAt,
    deactivatedAt: row.deactivatedAt,
  };
}

function mapAllocation(
  row: typeof userCollectionAllocations.$inferSelect,
): CollectionAllocationRecord {
  return {
    allocationId: row.id,
    lockReferenceId: row.lockReferenceId,
    allocatedQuantity: row.allocatedQuantity,
    status: row.status as CollectionAllocationRecord["status"],
  };
}

function mapAward(row: typeof userCollectionAwards.$inferSelect): CollectionAwardRecord {
  return {
    awardId: row.id,
    firstCompletedAt: row.firstCompletedAt,
    completionSequence: row.completionSequence,
  };
}

class PostgresCollectionTransaction implements CollectionTransaction {
  constructor(private readonly tx: DatabaseTransaction) {}

  async lockUser(userId: string): Promise<void> {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`collections:${userId}`}))`);
  }

  async getDefinitionBySlug(slug: string): Promise<CollectionDefinitionContext | null> {
    const [row] = await this.tx
      .select({
        definitionId: collectionDefinitions.id,
        slug: collectionDefinitions.slug,
        kind: collectionDefinitions.kind,
        lifecycleStatus: collectionDefinitions.lifecycleStatus,
        currentVersion: collectionDefinitions.currentVersion,
        versionId: collectionDefinitionVersions.id,
        version: collectionDefinitionVersions.version,
        versionState: collectionDefinitionVersions.state,
      })
      .from(collectionDefinitions)
      .innerJoin(
        collectionDefinitionVersions,
        and(
          eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
          eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
        ),
      )
      .where(eq(collectionDefinitions.slug, slug))
      .for("update");
    return row ? mapDefinition(row) : null;
  }

  async getDefinitionForVersion(versionId: string): Promise<CollectionDefinitionContext | null> {
    const [row] = await this.tx
      .select({
        definitionId: collectionDefinitions.id,
        slug: collectionDefinitions.slug,
        kind: collectionDefinitions.kind,
        lifecycleStatus: collectionDefinitions.lifecycleStatus,
        currentVersion: collectionDefinitions.currentVersion,
        versionId: collectionDefinitionVersions.id,
        version: collectionDefinitionVersions.version,
        versionState: collectionDefinitionVersions.state,
      })
      .from(collectionDefinitionVersions)
      .innerJoin(
        collectionDefinitions,
        eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
      )
      .where(eq(collectionDefinitionVersions.id, versionId))
      .for("update");
    return row ? mapDefinition(row) : null;
  }

  async getSlot(slotId: string): Promise<CollectionSlotContext | null> {
    const [row] = await this.tx
      .select({
        slotId: collectionSlots.id,
        definitionId: collectionDefinitionVersions.definitionId,
        versionId: collectionSlots.collectionVersionId,
        playerId: collectionSlots.playerId,
        status: collectionSlots.status,
        requiredQuantity: collectionSlots.requiredQuantity,
      })
      .from(collectionSlots)
      .innerJoin(
        collectionDefinitionVersions,
        eq(collectionSlots.collectionVersionId, collectionDefinitionVersions.id),
      )
      .where(eq(collectionSlots.id, slotId))
      .for("update");
    return row || null;
  }

  async getAllocation(userId: string, slotId: string): Promise<CollectionAllocationRecord | null> {
    const [row] = await this.tx
      .select()
      .from(userCollectionAllocations)
      .where(
        and(
          eq(userCollectionAllocations.userId, userId),
          eq(userCollectionAllocations.collectionSlotId, slotId),
        ),
      )
      .for("update");
    return row ? mapAllocation(row) : null;
  }

  async assertAvailableShares(input: {
    userId: string;
    playerId: string;
    quantity: string;
    excludingLockReferenceId: string | null;
  }): Promise<void> {
    const identity = await loadPlayerIdentityContext(this.tx, input.playerId);
    const identityIds = identity.allIds;

    await this.tx
      .select({ id: holdings.id })
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, input.userId),
          eq(holdings.assetType, "player"),
          inArray(holdings.assetId, identityIds),
        ),
      )
      .orderBy(asc(holdings.id))
      .for("update");

    const lockFilter = input.excludingLockReferenceId
      ? and(
          eq(holdingsLocks.userId, input.userId),
          eq(holdingsLocks.assetType, "player"),
          inArray(holdingsLocks.assetId, identityIds),
          ne(holdingsLocks.lockReferenceId, input.excludingLockReferenceId),
        )
      : and(
          eq(holdingsLocks.userId, input.userId),
          eq(holdingsLocks.assetType, "player"),
          inArray(holdingsLocks.assetId, identityIds),
        );
    await this.tx
      .select({ id: holdingsLocks.id })
      .from(holdingsLocks)
      .where(lockFilter)
      .orderBy(asc(holdingsLocks.id))
      .for("update");

    const result = await this.tx.execute(sql`
      SELECT
        COALESCE((
          SELECT SUM(quantity)
          FROM holdings
          WHERE user_id = ${input.userId}
            AND asset_type = 'player'
            AND asset_id IN (${sql.join(
              identityIds.map((id) => sql`${id}`),
              sql`, `,
            )})
        ), 0)::text AS held_quantity,
        COALESCE((
          SELECT SUM(locked_quantity)
          FROM holdings_locks
          WHERE user_id = ${input.userId}
            AND asset_type = 'player'
            AND asset_id IN (${sql.join(
              identityIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            ${input.excludingLockReferenceId ? sql`AND lock_reference_id <> ${input.excludingLockReferenceId}` : sql``}
        ), 0)::text AS locked_quantity
    `);
    const row = result.rows[0] as { held_quantity: string; locked_quantity: string };
    const availableResult = await this.tx.execute(sql`
      SELECT GREATEST(
        ${row.held_quantity}::numeric - ${row.locked_quantity}::numeric,
        0::numeric
      )::text AS available
    `);
    const available = String((availableResult.rows[0] as { available: string }).available);
    if (compareCollectionQuantities(available, input.quantity) < 0) {
      throw new CollectionDomainError(
        "INSUFFICIENT_AVAILABLE_SHARES",
        "Insufficient available shares",
        409,
        { availableQuantity: available, requestedQuantity: input.quantity },
      );
    }
  }

  async upsertAllocation(input: {
    userId: string;
    slot: CollectionSlotContext;
    quantity: string;
    lockReferenceId: string;
    now: Date;
  }): Promise<CollectionAllocationRecord> {
    const [row] = await this.tx
      .insert(userCollectionAllocations)
      .values({
        userId: input.userId,
        collectionSlotId: input.slot.slotId,
        playerId: input.slot.playerId!,
        allocatedQuantity: input.quantity,
        lockReferenceId: input.lockReferenceId,
        status: "active",
        releasedAt: null,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [userCollectionAllocations.userId, userCollectionAllocations.collectionSlotId],
        set: {
          playerId: input.slot.playerId!,
          allocatedQuantity: input.quantity,
          lockReferenceId: input.lockReferenceId,
          status: "active",
          releasedAt: null,
          updatedAt: input.now,
        },
      })
      .returning();
    return mapAllocation(row);
  }

  async upsertCollectionLock(input: {
    userId: string;
    playerId: string;
    lockReferenceId: string;
    quantity: string;
  }): Promise<void> {
    await this.tx.execute(sql`
      INSERT INTO holdings_locks (
        user_id, asset_type, asset_id, lock_type, lock_reference_id, locked_quantity
      ) VALUES (
        ${input.userId}, 'player', ${input.playerId}, 'collection',
        ${input.lockReferenceId}, ${input.quantity}::numeric
      )
      ON CONFLICT (lock_reference_id) WHERE lock_type = 'collection'
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        asset_type = EXCLUDED.asset_type,
        asset_id = EXCLUDED.asset_id,
        locked_quantity = EXCLUDED.locked_quantity
    `);
  }

  async releaseAllocation(input: {
    userId: string;
    slotId: string;
    now: Date;
  }): Promise<CollectionAllocationRecord | null> {
    const [row] = await this.tx
      .update(userCollectionAllocations)
      .set({ status: "released", releasedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(userCollectionAllocations.userId, input.userId),
          eq(userCollectionAllocations.collectionSlotId, input.slotId),
          eq(userCollectionAllocations.status, "active"),
        ),
      )
      .returning();
    return row ? mapAllocation(row) : null;
  }

  async deleteCollectionLock(lockReferenceId: string): Promise<void> {
    await this.tx
      .delete(holdingsLocks)
      .where(
        and(
          eq(holdingsLocks.lockReferenceId, lockReferenceId),
          eq(holdingsLocks.lockType, "collection"),
        ),
      );
  }

  async getState(userId: string, versionId: string): Promise<CollectionProgressSnapshot | null> {
    const [row] = await this.tx
      .select()
      .from(userCollectionStates)
      .where(
        and(
          eq(userCollectionStates.userId, userId),
          eq(userCollectionStates.collectionVersionId, versionId),
        ),
      )
      .for("update");
    return row ? mapState(row) : null;
  }

  async getRequirements(
    userId: string,
    context: CollectionDefinitionContext,
  ): Promise<Array<{ requiredQuantity: string; allocatedQuantity: string }>> {
    if (context.kind === "master") {
      const prerequisiteState = alias(userCollectionStates, "prerequisite_state");
      const rows = await this.tx
        .select({
          allocatedQuantity: sql<string>`CASE WHEN ${prerequisiteState.assemblyState} = 'active' THEN '1.0000' ELSE '0.0000' END`,
        })
        .from(collectionPrerequisites)
        .leftJoin(
          prerequisiteState,
          and(
            eq(prerequisiteState.userId, userId),
            eq(
              prerequisiteState.collectionVersionId,
              collectionPrerequisites.prerequisiteVersionId,
            ),
          ),
        )
        .where(
          and(
            eq(collectionPrerequisites.masterVersionId, context.versionId),
            eq(collectionPrerequisites.isRequired, true),
          ),
        )
        .orderBy(asc(collectionPrerequisites.displayOrder), asc(collectionPrerequisites.id));
      return rows.map((row) => ({
        requiredQuantity: "1.0000",
        allocatedQuantity: row.allocatedQuantity,
      }));
    }

    const allocation = alias(userCollectionAllocations, "active_collection_allocation");
    return this.tx
      .select({
        requiredQuantity: collectionSlots.requiredQuantity,
        allocatedQuantity: sql<string>`COALESCE(${allocation.allocatedQuantity}, '0.0000')`,
      })
      .from(collectionSlots)
      .leftJoin(
        allocation,
        and(
          eq(allocation.userId, userId),
          eq(allocation.collectionSlotId, collectionSlots.id),
          eq(allocation.status, "active"),
        ),
      )
      .where(
        and(
          eq(collectionSlots.collectionVersionId, context.versionId),
          eq(collectionSlots.isRequired, true),
          eq(collectionSlots.status, "active"),
        ),
      )
      .orderBy(asc(collectionSlots.displayOrder), asc(collectionSlots.id));
  }

  async upsertState(
    userId: string,
    context: CollectionDefinitionContext,
    state: CollectionProgressSnapshot,
    now: Date,
  ): Promise<CollectionProgressSnapshot> {
    const [row] = await this.tx
      .insert(userCollectionStates)
      .values({
        userId,
        collectionDefinitionId: context.definitionId,
        collectionVersionId: context.versionId,
        ...state,
        evaluatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userCollectionStates.userId, userCollectionStates.collectionVersionId],
        set: {
          collectionDefinitionId: context.definitionId,
          ...state,
          evaluatedAt: now,
          updatedAt: now,
        },
      })
      .returning();
    return mapState(row);
  }

  async appendStateEvent(event: CollectionStateEventInput): Promise<string> {
    const [row] = await this.tx
      .insert(userCollectionStateEvents)
      .values({
        userId: event.userId,
        collectionDefinitionId: event.definitionId,
        collectionVersionId: event.versionId,
        eventType: event.eventType,
        previousState: event.previousState,
        nextState: event.nextState,
        reason: event.reason,
        metadata: event.metadata,
        occurredAt: event.occurredAt,
      })
      .returning({ id: userCollectionStateEvents.id });
    return row.id;
  }

  async getParentDefinitions(versionId: string): Promise<CollectionDefinitionContext[]> {
    const parentVersion = alias(collectionDefinitionVersions, "parent_collection_version");
    const rows = await this.tx
      .select({
        definitionId: collectionDefinitions.id,
        slug: collectionDefinitions.slug,
        kind: collectionDefinitions.kind,
        lifecycleStatus: collectionDefinitions.lifecycleStatus,
        currentVersion: collectionDefinitions.currentVersion,
        versionId: parentVersion.id,
        version: parentVersion.version,
        versionState: parentVersion.state,
      })
      .from(collectionPrerequisites)
      .innerJoin(parentVersion, eq(parentVersion.id, collectionPrerequisites.masterVersionId))
      .innerJoin(
        collectionDefinitions,
        and(
          eq(collectionDefinitions.id, parentVersion.definitionId),
          eq(collectionDefinitions.currentVersion, parentVersion.version),
        ),
      )
      .where(eq(collectionPrerequisites.prerequisiteVersionId, versionId));
    return rows.map(mapDefinition);
  }

  async getAward(userId: string, versionId: string): Promise<CollectionAwardRecord | null> {
    const [row] = await this.tx
      .select()
      .from(userCollectionAwards)
      .where(
        and(
          eq(userCollectionAwards.userId, userId),
          eq(userCollectionAwards.collectionVersionId, versionId),
        ),
      );
    return row ? mapAward(row) : null;
  }

  async getNextCompletionSequence(userId: string): Promise<number> {
    const [row] = await this.tx
      .select({ next: sql<number>`COUNT(*)::integer + 1` })
      .from(userCollectionAwards)
      .where(eq(userCollectionAwards.userId, userId));
    return Number(row?.next || 1);
  }

  async insertAward(input: {
    userId: string;
    context: CollectionDefinitionContext;
    firstCompletedAt: Date;
    completionSequence: number;
  }): Promise<CollectionAwardRecord> {
    const [row] = await this.tx
      .insert(userCollectionAwards)
      .values({
        userId: input.userId,
        collectionDefinitionId: input.context.definitionId,
        collectionVersionId: input.context.versionId,
        firstCompletedAt: input.firstCompletedAt,
        completionSequence: input.completionSequence,
      })
      .returning();
    return mapAward(row);
  }
}

function isRetryableTransactionError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "40001" || code === "40P01";
}

export class PostgresCollectionRepository implements CollectionRepository {
  async transaction<T>(callback: (tx: CollectionTransaction) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await db.transaction((tx) => callback(new PostgresCollectionTransaction(tx)));
      } catch (error) {
        lastError = error;
        if (!isRetryableTransactionError(error) || attempt === 3) {
          throw this.mapDatabaseError(error);
        }
      }
    }
    throw lastError;
  }

  async listReconciliationCandidates(limit: number): Promise<CollectionReconciliationCandidate[]> {
    const result = await db.execute(sql`
      WITH candidates AS (
        SELECT user_id, collection_version_id FROM user_collection_states
        UNION
        SELECT a.user_id, s.collection_version_id
        FROM user_collection_allocations a
        JOIN collection_slots s ON s.id = a.collection_slot_id
      )
      SELECT candidates.user_id, candidates.collection_version_id
      FROM candidates
      LEFT JOIN user_collection_states s
        ON s.user_id = candidates.user_id
       AND s.collection_version_id = candidates.collection_version_id
      ORDER BY s.evaluated_at ASC NULLS FIRST, candidates.user_id, candidates.collection_version_id
      LIMIT ${limit}
    `);
    return result.rows.map((row) => ({
      userId: String((row as Record<string, unknown>).user_id),
      versionId: String((row as Record<string, unknown>).collection_version_id),
    }));
  }

  async listPlayerCandidates(
    userId: string,
    playerId: string,
  ): Promise<CollectionReconciliationCandidate[]> {
    const result = await db.execute(sql`
      WITH identity AS (
        SELECT COALESCE(
          (SELECT canonical_player_id FROM player_id_aliases WHERE alias_player_id = ${playerId}),
          ${playerId}
        ) AS canonical_id
      ), identity_ids AS (
        SELECT canonical_id AS player_id FROM identity
        UNION
        SELECT alias_player_id
        FROM player_id_aliases, identity
        WHERE canonical_player_id = identity.canonical_id
      )
      SELECT DISTINCT a.user_id, s.collection_version_id
      FROM user_collection_allocations a
      JOIN collection_slots s ON s.id = a.collection_slot_id
      WHERE a.user_id = ${userId}
        AND a.player_id IN (SELECT player_id FROM identity_ids)
      ORDER BY a.user_id, s.collection_version_id
    `);
    return result.rows.map((row) => ({
      userId: String((row as Record<string, unknown>).user_id),
      versionId: String((row as Record<string, unknown>).collection_version_id),
    }));
  }

  async resolveEarnedBadgePreferences(
    userId: string,
    limit: number,
  ): Promise<EarnedBadgePreference[]> {
    const result = await db.execute(sql`
      SELECT
        d.id AS definition_id,
        d.slug,
        v.title,
        v.art_key,
        p.priority,
        a.first_completed_at
      FROM user_badge_preferences p
      JOIN collection_definitions d
        ON d.id = p.collection_definition_id
      JOIN user_collection_states s
        ON s.user_id = p.user_id
       AND s.collection_definition_id = p.collection_definition_id
       AND s.assembly_state = 'active'
      JOIN collection_definition_versions v
        ON v.id = s.collection_version_id
       AND v.version = d.current_version
      JOIN user_collection_awards a
        ON a.user_id = s.user_id
       AND a.collection_version_id = s.collection_version_id
      WHERE p.user_id = ${userId}
        AND d.lifecycle_status IN ('tracking', 'final')
        AND v.state IN ('tracking', 'final')
      ORDER BY p.priority ASC, a.first_completed_at ASC, d.id ASC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        definitionId: String(record.definition_id),
        slug: String(record.slug),
        title: String(record.title),
        artKey: String(record.art_key),
        priority: Number(record.priority),
        firstCompletedAt: new Date(String(record.first_completed_at)),
      };
    });
  }

  private mapDatabaseError(error: unknown): unknown {
    const code = (error as { code?: string })?.code;
    if (code === "23505") {
      return new CollectionDomainError(
        "IDEMPOTENCY_CONFLICT",
        "A concurrent collection write conflicted with this request",
        409,
      );
    }
    if (code === "23514" || code === "23503" || code === "P0001") {
      return new CollectionDomainError(
        "COLLECTION_INTEGRITY_CONFLICT",
        "Collection integrity validation rejected the write",
        409,
      );
    }
    return error;
  }
}

export const collectionRepository = new PostgresCollectionRepository();
