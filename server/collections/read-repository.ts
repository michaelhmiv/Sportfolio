import {
  collectionDefinitionVersions,
  collectionDefinitions,
  collectionPrerequisites,
  collectionSlots,
  holdings,
  holdingsLocks,
  players,
  userCollectionAllocations,
  userCollectionAwards,
  userCollectionStates,
} from "@shared/schema";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { loadPlayerIdentityContexts } from "../player-identity";
import type {
  CollectionAssemblyState,
  CollectionDetailResponse,
  CollectionListEntry,
  CollectionPrerequisiteEntry,
  CollectionSlotEntry,
} from "@shared/collection-api";

// ── helpers ──────────────────────────────────────────────────────────────────

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapAssemblyState(value: string | null): CollectionAssemblyState {
  switch (value) {
    case "in_progress":
    case "ready":
    case "active":
    case "inactive":
      return value;
    default:
      return "unstarted";
  }
}

type CollectionProgressState = Pick<
  CollectionListEntry,
  | "assemblyState"
  | "allocatedQuantity"
  | "requiredQuantity"
  | "qualifiedSlotCount"
  | "requiredSlotCount"
  | "progressBps"
>;

function sumQuantities(values: string[]): string {
  const scale = BigInt(10_000);
  let total = BigInt(0);
  for (const value of values) {
    const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
    if (!match) continue;
    total += BigInt(match[1]) * scale + BigInt((match[2] ?? "").padEnd(4, "0"));
  }
  return `${total / scale}.${(total % scale).toString().padStart(4, "0")}`;
}

function defaultState(): CollectionProgressState {
  return {
    assemblyState: "unstarted",
    allocatedQuantity: "0.0000",
    requiredQuantity: "0.0000",
    qualifiedSlotCount: 0,
    requiredSlotCount: 0,
    progressBps: 0,
  };
}

const QUANTITY_SCALE = BigInt(10_000);

export function isCollectionPrerequisiteAvailable(
  lifecycleStatus: string,
  versionState: string,
): boolean {
  return (
    ["tracking", "final"].includes(lifecycleStatus) && ["tracking", "final"].includes(versionState)
  );
}

function parseQuantityUnits(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) return BigInt(0);
  return BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? "").padEnd(4, "0"));
}

function formatQuantityUnits(units: bigint): string {
  const integerPart = units / QUANTITY_SCALE;
  const fractionalPart = (units % QUANTITY_SCALE).toString().padStart(4, "0");
  return `${integerPart}.${fractionalPart}`;
}

function formatStatLabel(statKey: string | null): string | null {
  if (!statKey) return null;
  const labels: Record<string, string> = {
    homeRuns: "HR",
    rbi: "RBI",
    ops: "OPS",
    onBasePlusSlugging: "OPS",
    strikeOuts: "K",
    strikeouts: "K",
    earnedRunAverage: "ERA",
    era: "ERA",
    saves: "SV",
    stolenBases: "SB",
    battingAverage: "AVG",
    hits: "H",
    runs: "R",
    runsBattedIn: "RBI",
    walks: "BB",
    inningsPitched: "IP",
    pitchingStrikeouts: "K",
    wins: "W",
  };
  return labels[statKey] ?? statKey;
}

type SlotAvailabilityInput = {
  playerId: string | null;
  lockReferenceId: string | null;
  requiredQuantity: string;
};

export function computeMaxAllocatableQuantities(
  slots: SlotAvailabilityInput[],
  playerIdToAllIds: Map<string, Set<string>>,
  holdingsByAsset: Map<string, bigint>,
  locksByAsset: Map<string, Map<string, bigint>>,
): Map<number, string> {
  const result = new Map<number, string>();
  for (const [index, detail] of computeSlotAvailabilityDetails(
    slots,
    playerIdToAllIds,
    holdingsByAsset,
    locksByAsset,
  )) {
    result.set(index, detail.maxAllocatableQuantity);
  }
  return result;
}

export function computeSlotAvailabilityDetails(
  slots: SlotAvailabilityInput[],
  playerIdToAllIds: Map<string, Set<string>>,
  holdingsByAsset: Map<string, bigint>,
  locksByAsset: Map<string, Map<string, bigint>>,
): Map<
  number,
  {
    ownedQuantity: string;
    lockedElsewhereQuantity: string;
    maxAllocatableQuantity: string;
  }
> {
  const result = new Map<
    number,
    {
      ownedQuantity: string;
      lockedElsewhereQuantity: string;
      maxAllocatableQuantity: string;
    }
  >();

  slots.forEach((slot, index) => {
    if (!slot.playerId) return;
    const allIds = playerIdToAllIds.get(slot.playerId);
    if (!allIds) return;

    let held = BigInt(0);
    let locked = BigInt(0);
    for (const id of allIds) {
      held += holdingsByAsset.get(id) ?? BigInt(0);
      const lockMap = locksByAsset.get(id);
      if (!lockMap) continue;
      for (const [referenceId, quantity] of lockMap) {
        if (referenceId !== slot.lockReferenceId) locked += quantity;
      }
    }

    const available = held > locked ? held - locked : BigInt(0);
    const required = parseQuantityUnits(slot.requiredQuantity);
    result.set(index, {
      ownedQuantity: formatQuantityUnits(held),
      lockedElsewhereQuantity: formatQuantityUnits(locked),
      maxAllocatableQuantity: formatQuantityUnits(available < required ? available : required),
    });
  });

  return result;
}

// ── repository interface ─────────────────────────────────────────────────────

export interface CollectionReadRepository {
  listCollections(userId: string): Promise<CollectionListEntry[]>;
  getCollectionBySlug(userId: string, slug: string): Promise<CollectionDetailResponse | null>;
}

// ── implementation ───────────────────────────────────────────────────────────

export class PostgresCollectionReadRepository implements CollectionReadRepository {
  async listCollections(userId: string): Promise<CollectionListEntry[]> {
    const rows = await db
      .select({
        // definition
        slug: collectionDefinitions.slug,
        definitionId: collectionDefinitions.id,
        sport: collectionDefinitions.sport,
        league: collectionDefinitions.league,
        season: collectionDefinitions.season,
        family: collectionDefinitions.family,
        kind: collectionDefinitions.kind,
        lifecycleStatus: collectionDefinitions.lifecycleStatus,
        // version
        versionId: collectionDefinitionVersions.id,
        version: collectionDefinitionVersions.version,
        title: collectionDefinitionVersions.title,
        description: collectionDefinitionVersions.description,
        artKey: collectionDefinitionVersions.artKey,
        state: collectionDefinitionVersions.state,
        // user state
        assemblyState: userCollectionStates.assemblyState,
        allocatedQuantity: userCollectionStates.allocatedQuantity,
        requiredQuantity: userCollectionStates.requiredQuantity,
        qualifiedSlotCount: userCollectionStates.qualifiedSlotCount,
        requiredSlotCount: userCollectionStates.requiredSlotCount,
        progressBps: userCollectionStates.progressBps,
        // award
        awardId: userCollectionAwards.id,
        awardFirstCompletedAt: userCollectionAwards.firstCompletedAt,
        awardCompletionSequence: userCollectionAwards.completionSequence,
      })
      .from(collectionDefinitions)
      .innerJoin(
        collectionDefinitionVersions,
        and(
          eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
          eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
        ),
      )
      .leftJoin(
        userCollectionStates,
        and(
          eq(userCollectionStates.userId, userId),
          eq(userCollectionStates.collectionVersionId, collectionDefinitionVersions.id),
        ),
      )
      .leftJoin(
        userCollectionAwards,
        and(
          eq(userCollectionAwards.userId, userId),
          eq(userCollectionAwards.collectionVersionId, collectionDefinitionVersions.id),
        ),
      )
      .where(
        and(
          or(
            eq(collectionDefinitions.lifecycleStatus, "tracking"),
            eq(collectionDefinitions.lifecycleStatus, "final"),
          ),
          or(
            eq(collectionDefinitionVersions.state, "tracking"),
            eq(collectionDefinitionVersions.state, "final"),
          ),
          sql<boolean>`NOT EXISTS (
            SELECT 1
            FROM collection_prerequisites cp
            JOIN collection_definition_versions pv ON pv.id = cp.prerequisite_version_id
            JOIN collection_definitions pd ON pd.id = pv.definition_id
            WHERE cp.master_version_id = ${collectionDefinitionVersions.id}
              AND cp.is_required = TRUE
              AND pd.lifecycle_status NOT IN ('tracking', 'final')
              AND pv.state NOT IN ('tracking', 'final')
          )`,
        ),
      )
      .orderBy(
        asc(collectionDefinitions.sport),
        asc(collectionDefinitions.season),
        asc(collectionDefinitions.family),
        asc(collectionDefinitions.slug),
      );

    // ── Bulk compute defaults for rows without a user state ────────────────
    const missingVersionIds = rows.filter((r) => !r.assemblyState).map((r) => r.versionId);

    let slotDefaults: Map<string, { requiredQuantity: string; requiredSlotCount: number }> =
      new Map();
    let masterDefaults: Map<string, { requiredSlotCount: number }> = new Map();

    if (missingVersionIds.length > 0) {
      // Single query for player_slots defaults
      const slotRows = await db
        .select({
          versionId: collectionSlots.collectionVersionId,
          count: sql<number>`CAST(COUNT(*) AS INTEGER)`,
          totalQuantity: sql<
            string | null
          >`SUM(${collectionSlots.requiredQuantity}::numeric)::text`,
        })
        .from(collectionSlots)
        .where(
          and(
            inArray(collectionSlots.collectionVersionId, missingVersionIds),
            eq(collectionSlots.isRequired, true),
            eq(collectionSlots.status, "active"),
          ),
        )
        .groupBy(collectionSlots.collectionVersionId);

      for (const r of slotRows) {
        slotDefaults.set(r.versionId, {
          requiredQuantity: r.totalQuantity ?? "0.0000",
          requiredSlotCount: r.count,
        });
      }

      // Single query for master defaults
      const masterRows = await db
        .select({
          versionId: collectionPrerequisites.masterVersionId,
          count: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        })
        .from(collectionPrerequisites)
        .where(
          and(
            inArray(collectionPrerequisites.masterVersionId, missingVersionIds),
            eq(collectionPrerequisites.isRequired, true),
          ),
        )
        .groupBy(collectionPrerequisites.masterVersionId);

      for (const r of masterRows) {
        masterDefaults.set(r.versionId, { requiredSlotCount: r.count });
      }
    }

    return rows.map((row) => {
      const state: CollectionProgressState = row.assemblyState
        ? {
            assemblyState: mapAssemblyState(row.assemblyState),
            allocatedQuantity: row.allocatedQuantity ?? "0.0000",
            requiredQuantity: row.requiredQuantity ?? "0.0000",
            qualifiedSlotCount: row.qualifiedSlotCount ?? 0,
            requiredSlotCount: row.requiredSlotCount ?? 0,
            progressBps: row.progressBps ?? 0,
          }
        : (() => {
            if (row.kind === "player_slots") {
              const d = slotDefaults.get(row.versionId);
              const requiredQuantity = d?.requiredQuantity ?? "0.0000";
              return {
                ...defaultState(),
                requiredQuantity,
                requiredSlotCount: d?.requiredSlotCount ?? 0,
              };
            }
            const d = masterDefaults.get(row.versionId);
            const requiredSlotCount = d?.requiredSlotCount ?? 0;
            return {
              ...defaultState(),
              requiredQuantity: `${requiredSlotCount}.0000`,
              requiredSlotCount,
            };
          })();

      const award = row.awardId
        ? {
            awardId: row.awardId,
            firstCompletedAt: iso(row.awardFirstCompletedAt)!,
            completionSequence: row.awardCompletionSequence ?? null,
          }
        : null;

      return {
        slug: row.slug,
        definitionId: row.definitionId,
        sport: row.sport,
        league: row.league,
        season: row.season,
        family: row.family,
        kind: row.kind as "player_slots" | "master",
        lifecycleStatus: row.lifecycleStatus as "tracking" | "final",
        versionId: row.versionId,
        version: row.version,
        title: row.title,
        description: row.description,
        artKey: row.artKey,
        state: row.state as "tracking" | "final",
        ...state,
        award,
      };
    });
  }

  async getCollectionBySlug(
    userId: string,
    slug: string,
  ): Promise<CollectionDetailResponse | null> {
    const [base] = await db
      .select({
        // definition
        slug: collectionDefinitions.slug,
        definitionId: collectionDefinitions.id,
        sport: collectionDefinitions.sport,
        league: collectionDefinitions.league,
        season: collectionDefinitions.season,
        family: collectionDefinitions.family,
        kind: collectionDefinitions.kind,
        lifecycleStatus: collectionDefinitions.lifecycleStatus,
        // version
        versionId: collectionDefinitionVersions.id,
        version: collectionDefinitionVersions.version,
        title: collectionDefinitionVersions.title,
        description: collectionDefinitionVersions.description,
        qualificationDescription: collectionDefinitionVersions.qualificationDescription,
        artKey: collectionDefinitionVersions.artKey,
        state: collectionDefinitionVersions.state,
        // user state
        assemblyState: userCollectionStates.assemblyState,
        allocatedQuantity: userCollectionStates.allocatedQuantity,
        requiredQuantity: userCollectionStates.requiredQuantity,
        qualifiedSlotCount: userCollectionStates.qualifiedSlotCount,
        requiredSlotCount: userCollectionStates.requiredSlotCount,
        progressBps: userCollectionStates.progressBps,
        // award
        awardId: userCollectionAwards.id,
        awardFirstCompletedAt: userCollectionAwards.firstCompletedAt,
        awardCompletionSequence: userCollectionAwards.completionSequence,
      })
      .from(collectionDefinitions)
      .innerJoin(
        collectionDefinitionVersions,
        and(
          eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
          eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
        ),
      )
      .leftJoin(
        userCollectionStates,
        and(
          eq(userCollectionStates.userId, userId),
          eq(userCollectionStates.collectionVersionId, collectionDefinitionVersions.id),
        ),
      )
      .leftJoin(
        userCollectionAwards,
        and(
          eq(userCollectionAwards.userId, userId),
          eq(userCollectionAwards.collectionVersionId, collectionDefinitionVersions.id),
        ),
      )
      .where(eq(collectionDefinitions.slug, slug));

    if (!base) return null;

    if (!["tracking", "final"].includes(base.lifecycleStatus)) return null;
    if (!["tracking", "final"].includes(base.state)) return null;

    const award = base.awardId
      ? {
          awardId: base.awardId,
          firstCompletedAt: iso(base.awardFirstCompletedAt)!,
          completionSequence: base.awardCompletionSequence ?? null,
        }
      : null;

    // Fetch slots with allocation + player (all active slots, including optional).
    const slots = await this.fetchSlots(userId, base.versionId);

    // Fetch prerequisites (for master collections).
    const prerequisites =
      base.kind === "master" ? await this.fetchPrerequisites(userId, base.versionId) : [];
    if (prerequisites.some((entry) => entry.isRequired && entry.isAvailable === false)) {
      return null;
    }

    const requiredEntries =
      base.kind === "master"
        ? prerequisites.filter((entry) => entry.isRequired)
        : slots.filter((entry) => entry.isRequired);
    const defaultRequiredQuantity =
      base.kind === "master"
        ? `${requiredEntries.length}.0000`
        : sumQuantities(
            (requiredEntries as CollectionSlotEntry[]).map((entry) => entry.requiredQuantity),
          );
    const state: CollectionProgressState = base.assemblyState
      ? {
          assemblyState: mapAssemblyState(base.assemblyState),
          allocatedQuantity: base.allocatedQuantity ?? "0.0000",
          requiredQuantity: base.requiredQuantity ?? defaultRequiredQuantity,
          qualifiedSlotCount: base.qualifiedSlotCount ?? 0,
          requiredSlotCount: base.requiredSlotCount ?? requiredEntries.length,
          progressBps: base.progressBps ?? 0,
        }
      : {
          ...defaultState(),
          requiredQuantity: defaultRequiredQuantity,
          requiredSlotCount: requiredEntries.length,
        };

    return {
      slug: base.slug,
      definitionId: base.definitionId,
      sport: base.sport,
      league: base.league,
      season: base.season,
      family: base.family,
      kind: base.kind as "player_slots" | "master",
      lifecycleStatus: base.lifecycleStatus as "tracking" | "final",
      versionId: base.versionId,
      version: base.version,
      title: base.title,
      description: base.description,
      qualificationDescription: base.qualificationDescription,
      artKey: base.artKey,
      state: base.state as "tracking" | "final",
      ...state,
      award,
      slots,
      prerequisites,
    };
  }

  /**
   * Fetch all active slots (including optional) with allocation, player,
   * and maxAllocatableQuantity.
   */
  private async fetchSlots(userId: string, versionId: string): Promise<CollectionSlotEntry[]> {
    const allocation = alias(userCollectionAllocations, "alloc");
    const rows = await db
      .select({
        slotId: collectionSlots.id,
        slotKey: collectionSlots.slotKey,
        slotLabel: collectionSlots.slotLabel,
        requiredQuantity: collectionSlots.requiredQuantity,
        isRequired: collectionSlots.isRequired,
        displayOrder: collectionSlots.displayOrder,
        rank: collectionSlots.rank,
        statKey: collectionSlots.statKey,
        qualificationValue: collectionSlots.qualificationValue,
        qualificationMetadata: collectionSlots.qualificationMetadata,
        status: collectionSlots.status,
        // allocation
        allocationId: allocation.id,
        allocatedQuantity: allocation.allocatedQuantity,
        allocationStatus: allocation.status,
        allocationLockRef: allocation.lockReferenceId,
        // player
        playerId: players.id,
        firstName: players.firstName,
        lastName: players.lastName,
        team: players.team,
        position: players.position,
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
      .leftJoin(players, eq(players.id, collectionSlots.playerId))
      .where(
        and(
          eq(collectionSlots.collectionVersionId, versionId),
          eq(collectionSlots.status, "active"),
        ),
      )
      .orderBy(asc(collectionSlots.displayOrder), asc(collectionSlots.id));

    // Compute maxAllocatableQuantity for slots with players.
    const playerIds = [...new Set(rows.map((r) => r.playerId).filter(Boolean))] as string[];
    const availabilityMap = await this.computeSlotAvailabilityMap(
      userId,
      playerIds,
      rows.map((r) => ({
        playerId: r.playerId,
        lockReferenceId: r.allocationLockRef ?? null,
        requiredQuantity: r.requiredQuantity,
      })),
    );

    return rows.map((row, idx) => ({
      slotId: row.slotId,
      slotKey: row.slotKey,
      slotLabel: row.slotLabel,
      requiredQuantity: row.requiredQuantity,
      isRequired: row.isRequired,
      displayOrder: row.displayOrder,
      rank: row.rank,
      statKey: row.statKey,
      qualificationValue: row.qualificationValue ?? null,
      qualificationMetadata: row.qualificationMetadata
        ? (row.qualificationMetadata as Record<string, unknown>)
        : null,
      statLabel: formatStatLabel(row.statKey),
      allocation: row.allocationId
        ? {
            allocationId: row.allocationId,
            allocatedQuantity: row.allocatedQuantity ?? "0.0000",
            status: (row.allocationStatus ?? "active") as "active" | "released",
          }
        : null,
      maxAllocatableQuantity: row.playerId
        ? (availabilityMap.get(idx)?.maxAllocatableQuantity ?? row.requiredQuantity)
        : null,
      ownedQuantity: row.playerId ? (availabilityMap.get(idx)?.ownedQuantity ?? "0.0000") : null,
      lockedElsewhereQuantity: row.playerId
        ? (availabilityMap.get(idx)?.lockedElsewhereQuantity ?? "0.0000")
        : null,
      player: row.playerId
        ? {
            playerId: row.playerId,
            firstName: row.firstName ?? "",
            lastName: row.lastName ?? "",
            team: row.team ?? "",
            position: row.position ?? "",
          }
        : null,
    }));
  }

  /**
   * Compute max allocatable quantity for each slot by looking up user holdings
   * and locks (excluding the slot's own lock).  Returns a Map<slotIndex, quantity string>.
   */
  private async computeSlotAvailabilityMap(
    userId: string,
    playerIds: string[],
    slotMeta: Array<{
      playerId: string | null;
      lockReferenceId: string | null;
      requiredQuantity: string;
    }>,
  ): Promise<
    Map<
      number,
      {
        ownedQuantity: string;
        lockedElsewhereQuantity: string;
        maxAllocatableQuantity: string;
      }
    >
  > {
    if (playerIds.length === 0) return new Map();

    // Resolve canonical identities for all distinct player IDs
    const identityContextMap = await loadPlayerIdentityContexts(db, playerIds);
    const identityContexts = playerIds.map((playerId) => {
      const context = identityContextMap.get(playerId);
      if (!context) {
        throw new Error(`Player identity context missing for ${playerId}`);
      }
      return context;
    });
    const playerIdToAllIds = new Map<string, Set<string>>();
    for (const ctx of identityContexts) {
      playerIdToAllIds.set(ctx.requestedId, new Set(ctx.allIds));
    }

    // Collect all resolved IDs
    const allResolvedIds = [...new Set(identityContexts.flatMap((ctx) => ctx.allIds))];

    // Query holdings
    const holdingsResult = await db.execute(sql`
      SELECT asset_id, SUM(quantity)::text AS held
      FROM holdings
      WHERE user_id = ${userId}
        AND asset_type = 'player'
        AND asset_id IN (${sql.join(
          allResolvedIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      GROUP BY asset_id
    `);
    const holdingsByAsset = new Map<string, bigint>();
    for (const r of holdingsResult.rows as Array<{ asset_id: string; held: string }>) {
      holdingsByAsset.set(r.asset_id, parseQuantityUnits(r.held));
    }

    // Query locks (all locks for these identities)
    const locksResult = await db.execute(sql`
      SELECT asset_id, lock_reference_id, SUM(locked_quantity)::text AS locked
      FROM holdings_locks
      WHERE user_id = ${userId}
        AND asset_type = 'player'
        AND asset_id IN (${sql.join(
          allResolvedIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      GROUP BY asset_id, lock_reference_id
    `);

    // Build lock map: assetId → { lockRefId → totalLocked }
    const locksByAsset = new Map<string, Map<string, bigint>>();
    for (const r of locksResult.rows as Array<{
      asset_id: string;
      lock_reference_id: string;
      locked: string;
    }>) {
      if (!locksByAsset.has(r.asset_id)) {
        locksByAsset.set(r.asset_id, new Map());
      }
      locksByAsset.get(r.asset_id)!.set(r.lock_reference_id, parseQuantityUnits(r.locked));
    }

    return computeSlotAvailabilityDetails(
      slotMeta,
      playerIdToAllIds,
      holdingsByAsset,
      locksByAsset,
    );
  }

  private async fetchPrerequisites(
    userId: string,
    masterVersionId: string,
  ): Promise<CollectionPrerequisiteEntry[]> {
    const prerequisiteVersion = alias(collectionDefinitionVersions, "prereq_version");
    const prerequisiteDefinition = alias(collectionDefinitions, "prereq_def");
    const prerequisiteState = alias(userCollectionStates, "prereq_state");

    const rows = await db
      .select({
        prerequisiteId: collectionPrerequisites.prerequisiteVersionId,
        isRequired: collectionPrerequisites.isRequired,
        displayOrder: collectionPrerequisites.displayOrder,
        slug: prerequisiteDefinition.slug,
        title: prerequisiteVersion.title,
        artKey: prerequisiteVersion.artKey,
        lifecycleStatus: prerequisiteDefinition.lifecycleStatus,
        versionState: prerequisiteVersion.state,
        assemblyState: prerequisiteState.assemblyState,
        progressBps: prerequisiteState.progressBps,
      })
      .from(collectionPrerequisites)
      .innerJoin(
        prerequisiteVersion,
        eq(prerequisiteVersion.id, collectionPrerequisites.prerequisiteVersionId),
      )
      .innerJoin(
        prerequisiteDefinition,
        eq(prerequisiteDefinition.id, prerequisiteVersion.definitionId),
      )
      .leftJoin(
        prerequisiteState,
        and(
          eq(prerequisiteState.userId, userId),
          eq(prerequisiteState.collectionVersionId, prerequisiteVersion.id),
        ),
      )
      .where(eq(collectionPrerequisites.masterVersionId, masterVersionId))
      .orderBy(asc(collectionPrerequisites.displayOrder), asc(collectionPrerequisites.id));

    return rows.map((row) => ({
      prerequisiteId: row.prerequisiteId,
      slug: row.slug,
      title: row.title,
      artKey: row.artKey,
      isRequired: row.isRequired,
      displayOrder: row.displayOrder,
      isAvailable:
        ["tracking", "final"].includes(row.lifecycleStatus) &&
        ["tracking", "final"].includes(row.versionState),
      state: {
        assemblyState: mapAssemblyState(row.assemblyState),
        progressBps: row.progressBps ?? 0,
      },
    }));
  }
}
