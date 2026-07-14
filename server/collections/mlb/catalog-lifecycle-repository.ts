import {
  collectionDefinitions,
  collectionDefinitionVersions,
  collectionPrerequisites,
  collectionSlots,
  holdingsLocks,
  userCollectionAllocations,
  userCollectionStateEvents,
  userCollectionStates,
} from "@shared/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { PostgresCollectionTransaction } from "../postgres-repository";
import type {
  CollectionBackendService,
  CollectionEventPayload,
  CollectionReconciliationCandidate,
} from "../service";
import type { MlbCatalogPreview } from "./catalog-preview";
import { planMembershipRefresh } from "./membership-plan";

type CatalogTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AtomicCollectionReconciler = Pick<
  CollectionBackendService,
  "reconcileCandidatesInTransaction"
>;
type AtomicReconciliationResult = Awaited<
  ReturnType<CollectionBackendService["reconcileCandidatesInTransaction"]>
>;

export interface DisableResult {
  slug: string;
  lifecycleStatus: "disabled";
  releasedAllocations: number;
  clearedLocks: number;
  reconciliation: Omit<AtomicReconciliationResult, "events" | "states">;
  committedEvents: CollectionEventPayload[];
}

interface CurrentCatalogContext {
  definitionId: string;
  lifecycleStatus: string;
  currentVersion: number;
  kind: string;
  versionId: string;
  versionState: string;
  sourceMetadata: unknown;
  correctionOfVersionId: string | null;
}

export interface TrackingRefreshResult {
  slug: string;
  versionId: string;
  membershipChanged: boolean;
  added: number;
  removed: number;
  replaced: number;
  releasedAllocations: number;
  participants: CollectionReconciliationCandidate[];
  sourceSha256: string;
  reconciliation: Omit<AtomicReconciliationResult, "events" | "states">;
  committedEvents: CollectionEventPayload[];
}

interface FinalVersionResult {
  slug: string;
  versionId: string;
  version: number;
  lifecycleStatus: "final";
  sourceSha256: string;
}

export interface FinalizationResult extends TrackingRefreshResult, FinalVersionResult {}

export interface CorrectionResult extends FinalVersionResult {
  correctionOfVersionId: string;
  releasedAllocations: number;
  participants: CollectionReconciliationCandidate[];
  idempotent: boolean;
  reconciliation: Omit<AtomicReconciliationResult, "events" | "states">;
  committedEvents: CollectionEventPayload[];
}

function assertSuccessfulPreview(preview: MlbCatalogPreview): void {
  if (!preview.ok) {
    throw new Error(
      `MLB catalog preview failed for ${preview.definition.slug}: ${preview.errors
        .map((error) => error.code)
        .join(", ")}`,
    );
  }
}

async function loadCurrentContext(
  tx: CatalogTransaction,
  slug: string,
): Promise<CurrentCatalogContext> {
  const [definition] = await tx
    .select({
      definitionId: collectionDefinitions.id,
      lifecycleStatus: collectionDefinitions.lifecycleStatus,
      currentVersion: collectionDefinitions.currentVersion,
      kind: collectionDefinitions.kind,
    })
    .from(collectionDefinitions)
    .where(eq(collectionDefinitions.slug, slug))
    .for("update");
  if (!definition) throw new Error(`Collection ${slug} was not found`);

  const [version] = await tx
    .select({
      versionId: collectionDefinitionVersions.id,
      versionState: collectionDefinitionVersions.state,
      sourceMetadata: collectionDefinitionVersions.sourceMetadata,
      correctionOfVersionId: collectionDefinitionVersions.correctionOfVersionId,
    })
    .from(collectionDefinitionVersions)
    .where(
      and(
        eq(collectionDefinitionVersions.definitionId, definition.definitionId),
        eq(collectionDefinitionVersions.version, definition.currentVersion),
      ),
    )
    .for("update");
  if (!version) throw new Error(`Collection ${slug} has no current version`);
  return { ...definition, ...version };
}

async function listParticipants(
  tx: CatalogTransaction,
  versionId: string,
): Promise<CollectionReconciliationCandidate[]> {
  const result = await tx.execute(sql`
    SELECT DISTINCT participant.user_id
    FROM (
      SELECT user_id
      FROM user_collection_states
      WHERE collection_version_id = ${versionId}
      UNION
      SELECT allocation.user_id
      FROM user_collection_allocations allocation
      JOIN collection_slots slot ON slot.id = allocation.collection_slot_id
      WHERE slot.collection_version_id = ${versionId}
        AND allocation.status = 'active'
    ) participant
    ORDER BY participant.user_id
  `);
  return result.rows.map((row) => ({
    userId: String((row as Record<string, unknown>).user_id),
    versionId,
  }));
}

class ParticipantSetChangedError extends Error {
  constructor(readonly participants: CollectionReconciliationCandidate[]) {
    super("Collection participant set changed while acquiring lifecycle locks");
  }
}

async function listCurrentParticipants(slug: string): Promise<CollectionReconciliationCandidate[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT participant.user_id, version.id AS version_id
    FROM collection_definitions definition
    JOIN collection_definition_versions version
      ON version.definition_id = definition.id
     AND version.version = definition.current_version
    CROSS JOIN LATERAL (
      SELECT state.user_id
      FROM user_collection_states state
      WHERE state.collection_version_id = version.id
      UNION
      SELECT allocation.user_id
      FROM user_collection_allocations allocation
      JOIN collection_slots slot ON slot.id = allocation.collection_slot_id
      WHERE slot.collection_version_id = version.id
        AND allocation.status = 'active'
    ) participant
    WHERE definition.slug = ${slug}
    ORDER BY participant.user_id
  `);
  return result.rows.map((row) => ({
    userId: String((row as Record<string, unknown>).user_id),
    versionId: String((row as Record<string, unknown>).version_id),
  }));
}

async function withLockedParticipants<T>(
  slug: string,
  callback: (
    tx: CatalogTransaction,
    collectionTx: PostgresCollectionTransaction,
    context: CurrentCatalogContext,
    participants: CollectionReconciliationCandidate[],
  ) => Promise<T>,
): Promise<T> {
  let expected = await listCurrentParticipants(slug);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('sportfolio_mlb_catalog_admin', 0))`,
        );
        const collectionTx = new PostgresCollectionTransaction(tx);
        const expectedUserIds = new Set(expected.map((participant) => participant.userId));
        for (const userId of Array.from(expectedUserIds).sort()) {
          await collectionTx.lockUser(userId);
        }

        const context = await loadCurrentContext(tx, slug);
        const participants = await listParticipants(tx, context.versionId);
        if (participants.some((participant) => !expectedUserIds.has(participant.userId))) {
          throw new ParticipantSetChangedError(participants);
        }
        return callback(tx, collectionTx, context, participants);
      });
    } catch (error) {
      if (!(error instanceof ParticipantSetChangedError)) throw error;
      const merged = new Map(
        [...expected, ...error.participants].map((participant) => [
          participant.userId,
          participant,
        ]),
      );
      expected = Array.from(merged.values()).sort((left, right) =>
        left.userId.localeCompare(right.userId),
      );
    }
  }

  throw new Error(`Collection ${slug} participant set did not stabilize`);
}

async function recordMembershipChangedEventsInTransaction(
  tx: CatalogTransaction,
  slug: string,
  versionId: string,
  participants: CollectionReconciliationCandidate[],
  metadata: Record<string, unknown>,
  reason: "tracking_refresh" | "final_correction" | "collection_disabled",
  occurredAt: Date,
): Promise<CollectionEventPayload[]> {
  if (participants.length === 0) return [];
  const userIds = Array.from(new Set(participants.map((participant) => participant.userId)));
  const rows = await tx
    .select({
      userId: userCollectionStates.userId,
      definitionId: userCollectionStates.collectionDefinitionId,
      assemblyState: userCollectionStates.assemblyState,
    })
    .from(userCollectionStates)
    .where(
      and(
        eq(userCollectionStates.collectionVersionId, versionId),
        inArray(userCollectionStates.userId, userIds),
      ),
    );
  if (rows.length === 0) return [];
  const inserted = await tx
    .insert(userCollectionStateEvents)
    .values(
      rows.map((row) => ({
        userId: row.userId,
        collectionDefinitionId: row.definitionId,
        collectionVersionId: versionId,
        eventType: "membership_changed",
        previousState: row.assemblyState,
        nextState: row.assemblyState,
        reason,
        metadata: { slug, ...metadata },
        occurredAt,
      })),
    )
    .returning({
      id: userCollectionStateEvents.id,
      userId: userCollectionStateEvents.userId,
      definitionId: userCollectionStateEvents.collectionDefinitionId,
      previousState: userCollectionStateEvents.previousState,
      nextState: userCollectionStateEvents.nextState,
    });
  return inserted.map((event) => ({
    eventId: event.id,
    userId: event.userId,
    definitionId: event.definitionId,
    versionId,
    eventType: "membership_changed",
    previousState: event.previousState as CollectionEventPayload["previousState"],
    nextState: event.nextState as CollectionEventPayload["nextState"],
    reason,
    metadata: { slug, ...metadata },
    occurredAt,
  }));
}

function publicReconciliationResult(result: AtomicReconciliationResult) {
  const { events: _events, states: _states, ...summary } = result;
  return summary;
}

async function releaseAllocationsForSlots(
  tx: CatalogTransaction,
  slotIds: string[],
  now: Date,
): Promise<{ releasedAllocations: number; clearedLocks: number }> {
  if (slotIds.length === 0) return { releasedAllocations: 0, clearedLocks: 0 };
  const allocations = await tx
    .select({
      id: userCollectionAllocations.id,
      lockReferenceId: userCollectionAllocations.lockReferenceId,
    })
    .from(userCollectionAllocations)
    .where(
      and(
        inArray(userCollectionAllocations.collectionSlotId, slotIds),
        eq(userCollectionAllocations.status, "active"),
      ),
    )
    .orderBy(asc(userCollectionAllocations.id))
    .for("update");
  if (allocations.length === 0) return { releasedAllocations: 0, clearedLocks: 0 };

  const allocationIds = allocations.map((allocation) => allocation.id);
  const lockReferenceIds = allocations.map((allocation) => allocation.lockReferenceId);
  await tx
    .update(userCollectionAllocations)
    .set({ status: "released", releasedAt: now, updatedAt: now })
    .where(inArray(userCollectionAllocations.id, allocationIds));
  const deletedLocks = await tx
    .delete(holdingsLocks)
    .where(
      and(
        inArray(holdingsLocks.lockReferenceId, lockReferenceIds),
        eq(holdingsLocks.lockType, "collection"),
      ),
    )
    .returning({ id: holdingsLocks.id });
  return { releasedAllocations: allocations.length, clearedLocks: deletedLocks.length };
}

function sourceMetadataSha256(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).sha256;
  return typeof value === "string" ? value : null;
}

export function prerequisiteLinksMatchCurrent(
  actual: Array<{ slug: string; versionId: string; isRequired: boolean }>,
  current: Array<{ slug: string; versionId: string }>,
  expectedSlugs: string[],
): boolean {
  if (actual.length !== expectedSlugs.length || current.length !== expectedSlugs.length) {
    return false;
  }
  const actualBySlug = new Map(actual.map((row) => [row.slug, row]));
  const currentBySlug = new Map(current.map((row) => [row.slug, row.versionId]));
  return expectedSlugs.every((slug) => {
    const linked = actualBySlug.get(slug);
    return linked?.isRequired === true && linked.versionId === currentBySlug.get(slug);
  });
}

async function masterPrerequisitesAreCurrent(
  tx: CatalogTransaction,
  masterVersionId: string,
  expectedSlugs: string[],
): Promise<boolean> {
  const actual = await tx
    .select({
      slug: collectionDefinitions.slug,
      versionId: collectionPrerequisites.prerequisiteVersionId,
      isRequired: collectionPrerequisites.isRequired,
    })
    .from(collectionPrerequisites)
    .innerJoin(
      collectionDefinitionVersions,
      eq(collectionDefinitionVersions.id, collectionPrerequisites.prerequisiteVersionId),
    )
    .innerJoin(
      collectionDefinitions,
      eq(collectionDefinitions.id, collectionDefinitionVersions.definitionId),
    )
    .where(eq(collectionPrerequisites.masterVersionId, masterVersionId));
  const current = await tx
    .select({
      slug: collectionDefinitions.slug,
      versionId: collectionDefinitionVersions.id,
    })
    .from(collectionDefinitions)
    .innerJoin(
      collectionDefinitionVersions,
      and(
        eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
        eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
      ),
    )
    .where(inArray(collectionDefinitions.slug, expectedSlugs));
  return prerequisiteLinksMatchCurrent(actual, current, expectedSlugs);
}

async function applyTrackingMembership(
  tx: CatalogTransaction,
  collectionTx: PostgresCollectionTransaction,
  context: CurrentCatalogContext,
  participants: CollectionReconciliationCandidate[],
  preview: MlbCatalogPreview,
  collections: AtomicCollectionReconciler,
  now: Date,
): Promise<TrackingRefreshResult> {
  if (context.kind !== "player_slots") {
    throw new Error(`Collection ${preview.definition.slug} is not a player-slot definition`);
  }
  if (context.lifecycleStatus !== "tracking" || context.versionState !== "tracking") {
    throw new Error(`Collection ${preview.definition.slug} is not tracking`);
  }
  if (preview.definition.kind !== "player_slots") {
    throw new Error(
      `Tracking refresh requires a player-slot collection: ${preview.definition.slug}`,
    );
  }
  const definition = preview.definition;

  const existingSlots = await tx
    .select({
      id: collectionSlots.id,
      slotKey: collectionSlots.slotKey,
      playerId: collectionSlots.playerId,
      requiredQuantity: collectionSlots.requiredQuantity,
      status: collectionSlots.status,
    })
    .from(collectionSlots)
    .where(eq(collectionSlots.collectionVersionId, context.versionId))
    .orderBy(asc(collectionSlots.displayOrder), asc(collectionSlots.id))
    .for("update");
  const plan = planMembershipRefresh(preview, existingSlots);
  const { releasedAllocations } = await releaseAllocationsForSlots(
    tx,
    plan.invalidatedSlotIds,
    now,
  );

  if (plan.removedSlotIds.length > 0) {
    await tx
      .update(collectionSlots)
      .set({ status: "removed", removedAt: now, updatedAt: now })
      .where(inArray(collectionSlots.id, plan.removedSlotIds));
  }

  for (const slot of plan.slots) {
    const values = {
      playerId: slot.playerId,
      slotLabel: slot.slotLabel,
      requiredQuantity: slot.requiredQuantity,
      isRequired: true,
      status: "active",
      rank: slot.rank,
      statKey: slot.statKey,
      qualificationValue: slot.qualificationValue,
      qualificationMetadata: slot.qualificationMetadata,
      displayOrder: slot.displayOrder,
      removedAt: null,
      updatedAt: now,
    } as const;
    if (slot.existingSlotId) {
      await tx
        .update(collectionSlots)
        .set(values)
        .where(eq(collectionSlots.id, slot.existingSlotId));
    } else {
      await tx.insert(collectionSlots).values({
        ...values,
        collectionVersionId: context.versionId,
        slotKey: slot.slotKey,
      });
    }
  }

  await tx
    .update(collectionDefinitionVersions)
    .set({
      title: definition.title,
      description: definition.description,
      qualificationDescription: definition.description,
      qualificationRules: definition.rule,
      sourceMetadata: preview.sourceSnapshot,
      points: definition.points,
      updatedAt: now,
    })
    .where(eq(collectionDefinitionVersions.id, context.versionId));
  await tx
    .update(collectionDefinitions)
    .set({ updatedAt: now })
    .where(eq(collectionDefinitions.id, context.definitionId));

  const affectedParticipants = plan.changed ? participants : [];
  const reconciliation = await collections.reconcileCandidatesInTransaction(
    collectionTx,
    affectedParticipants,
    "membership_changed",
    now,
  );
  const membershipEvents = await recordMembershipChangedEventsInTransaction(
    tx,
    definition.slug,
    context.versionId,
    affectedParticipants,
    { added: plan.added, removed: plan.removed, replaced: plan.replaced },
    "tracking_refresh",
    now,
  );

  return {
    slug: preview.definition.slug,
    versionId: context.versionId,
    membershipChanged: plan.changed,
    added: plan.added,
    removed: plan.removed,
    replaced: plan.replaced,
    releasedAllocations,
    participants: affectedParticipants,
    sourceSha256: preview.sourceSnapshot.sha256,
    reconciliation: publicReconciliationResult(reconciliation),
    committedEvents: [...reconciliation.events, ...membershipEvents],
  };
}

export async function refreshTrackingCollection(
  preview: MlbCatalogPreview,
  collections: AtomicCollectionReconciler,
): Promise<TrackingRefreshResult> {
  assertSuccessfulPreview(preview);
  if (preview.definition.kind !== "player_slots") {
    throw new Error(
      `Tracking refresh requires a player-slot collection: ${preview.definition.slug}`,
    );
  }
  return withLockedParticipants(
    preview.definition.slug,
    (tx, collectionTx, context, participants) =>
      applyTrackingMembership(
        tx,
        collectionTx,
        context,
        participants,
        preview,
        collections,
        new Date(),
      ),
  );
}

export async function finalizeTrackingCollection(
  preview: MlbCatalogPreview,
  collections: AtomicCollectionReconciler,
): Promise<FinalizationResult> {
  assertSuccessfulPreview(preview);
  if (preview.definition.kind !== "player_slots") {
    throw new Error(
      `Tracking finalization requires a player-slot collection: ${preview.definition.slug}`,
    );
  }

  return withLockedParticipants(
    preview.definition.slug,
    async (tx, collectionTx, context, participants) => {
      const now = new Date();
      const currentSha256 = sourceMetadataSha256(context.sourceMetadata);
      if (
        context.lifecycleStatus === "final" &&
        context.versionState === "final" &&
        currentSha256 === preview.sourceSnapshot.sha256
      ) {
        return {
          slug: preview.definition.slug,
          versionId: context.versionId,
          sourceSha256: currentSha256,
          membershipChanged: false,
          added: 0,
          removed: 0,
          replaced: 0,
          releasedAllocations: 0,
          participants,
          reconciliation: { scanned: 0, repaired: 0, errors: 0, publishedEvents: 0 },
          committedEvents: [],
          version: context.currentVersion,
          lifecycleStatus: "final" as const,
        };
      }
      const refreshed = await applyTrackingMembership(
        tx,
        collectionTx,
        context,
        participants,
        preview,
        collections,
        now,
      );

      await tx
        .update(collectionDefinitionVersions)
        .set({ state: "final", membershipLockedAt: now, finalizedAt: now, updatedAt: now })
        .where(eq(collectionDefinitionVersions.id, context.versionId));
      await tx
        .update(collectionDefinitions)
        .set({ lifecycleStatus: "final", finalizedAt: now, updatedAt: now })
        .where(eq(collectionDefinitions.id, context.definitionId));

      return {
        ...refreshed,
        version: context.currentVersion,
        lifecycleStatus: "final" as const,
      };
    },
  );
}

export async function createFinalCorrectionVersion(
  preview: MlbCatalogPreview,
  actorUserId: string,
  correctionReason: string,
  collections: AtomicCollectionReconciler,
): Promise<CorrectionResult> {
  assertSuccessfulPreview(preview);

  return withLockedParticipants(
    preview.definition.slug,
    async (tx, collectionTx, context, participants) => {
      const now = new Date();
      if (context.lifecycleStatus !== "final" || context.versionState !== "final") {
        throw new Error(`Collection ${preview.definition.slug} is not final`);
      }
      if (context.kind !== preview.definition.kind) {
        throw new Error(`Collection ${preview.definition.slug} kind does not match the correction`);
      }

      const existingSourceSha256 = sourceMetadataSha256(context.sourceMetadata);
      const masterLinksAreCurrent =
        preview.definition.kind !== "master" ||
        (await masterPrerequisitesAreCurrent(
          tx,
          context.versionId,
          preview.definition.prerequisiteSlugs,
        ));
      if (existingSourceSha256 === preview.sourceSnapshot.sha256 && masterLinksAreCurrent) {
        if (!context.correctionOfVersionId) {
          throw new Error(
            `Collection ${preview.definition.slug} correction does not change the source snapshot`,
          );
        }
        return {
          slug: preview.definition.slug,
          versionId: context.versionId,
          version: context.currentVersion,
          lifecycleStatus: "final" as const,
          sourceSha256: existingSourceSha256,
          correctionOfVersionId: context.correctionOfVersionId,
          releasedAllocations: 0,
          participants: [],
          idempotent: true,
          reconciliation: { scanned: 0, repaired: 0, errors: 0, publishedEvents: 0 },
          committedEvents: [],
        };
      }

      const oldSlots = await tx
        .select({ id: collectionSlots.id })
        .from(collectionSlots)
        .where(eq(collectionSlots.collectionVersionId, context.versionId))
        .orderBy(asc(collectionSlots.id));
      const { releasedAllocations } = await releaseAllocationsForSlots(
        tx,
        oldSlots.map((slot) => slot.id),
        now,
      );
      const nextVersion = context.currentVersion + 1;
      const [newVersion] = await tx
        .insert(collectionDefinitionVersions)
        .values({
          definitionId: context.definitionId,
          version: nextVersion,
          title: preview.definition.title,
          description: preview.definition.description,
          qualificationDescription: preview.definition.description,
          qualificationRules:
            preview.definition.kind === "player_slots"
              ? preview.definition.rule
              : { prerequisiteSlugs: preview.definition.prerequisiteSlugs },
          sourceType:
            preview.definition.kind === "player_slots"
              ? "mlb_statsapi"
              : "collection_prerequisites",
          sourceUri:
            preview.definition.kind === "player_slots" ? "https://statsapi.mlb.com/api/v1" : null,
          sourceMetadata: { ...preview.sourceSnapshot, correctionReason },
          points: preview.definition.points,
          artKey: preview.definition.slug,
          state: "draft",
          correctionOfVersionId: context.versionId,
          createdBy: actorUserId,
        })
        .returning({ id: collectionDefinitionVersions.id });

      if (preview.definition.kind === "player_slots") {
        const playerDefinition = preview.definition;
        await tx.insert(collectionSlots).values(
          preview.members.map((member, displayOrder) => ({
            collectionVersionId: newVersion.id,
            playerId: member.playerId,
            slotKey: `mlbam:${member.mlbamId}`,
            slotLabel: member.playerName,
            requiredQuantity: playerDefinition.slotQuantity.toFixed(4),
            isRequired: true,
            status: "active",
            rank: member.rank,
            statKey: member.statKey,
            qualificationValue: member.qualificationValue,
            qualificationMetadata: {
              mlbamId: member.mlbamId,
              position: member.position,
              ...member.sourceMetadata,
            },
            displayOrder,
          })),
        );
      } else {
        const prerequisites = await tx
          .select({
            slug: collectionDefinitions.slug,
            versionId: collectionDefinitionVersions.id,
          })
          .from(collectionDefinitions)
          .innerJoin(
            collectionDefinitionVersions,
            and(
              eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
              eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
            ),
          )
          .where(inArray(collectionDefinitions.slug, preview.definition.prerequisiteSlugs));
        const versionBySlug = new Map(prerequisites.map((row) => [row.slug, row.versionId]));
        if (versionBySlug.size !== preview.definition.prerequisiteSlugs.length) {
          throw new Error(`Correction ${preview.definition.slug} has unresolved prerequisites`);
        }
        await tx.insert(collectionPrerequisites).values(
          preview.definition.prerequisiteSlugs.map((prerequisiteSlug, displayOrder) => ({
            masterVersionId: newVersion.id,
            prerequisiteVersionId: versionBySlug.get(prerequisiteSlug)!,
            isRequired: true,
            displayOrder,
          })),
        );
      }

      await tx
        .update(collectionDefinitionVersions)
        .set({
          state: "final",
          publishedAt: now,
          membershipLockedAt: now,
          finalizedAt: now,
          updatedAt: now,
        })
        .where(eq(collectionDefinitionVersions.id, newVersion.id));
      await tx
        .update(collectionDefinitions)
        .set({ currentVersion: nextVersion, updatedAt: now })
        .where(eq(collectionDefinitions.id, context.definitionId));

      const reconciliation = await collections.reconcileCandidatesInTransaction(
        collectionTx,
        participants,
        "membership_changed",
        now,
      );
      const membershipEvents = await recordMembershipChangedEventsInTransaction(
        tx,
        preview.definition.slug,
        context.versionId,
        participants,
        { correctionVersionId: newVersion.id, correctionReason },
        "final_correction",
        now,
      );

      return {
        slug: preview.definition.slug,
        versionId: newVersion.id,
        version: nextVersion,
        lifecycleStatus: "final" as const,
        sourceSha256: preview.sourceSnapshot.sha256,
        correctionOfVersionId: context.versionId,
        releasedAllocations,
        participants,
        idempotent: false,
        reconciliation: publicReconciliationResult(reconciliation),
        committedEvents: [...reconciliation.events, ...membershipEvents],
      };
    },
  );
}

export async function disableCollectionDefinition(
  slug: string,
  reason: string,
  expectedVersion: number,
  expectedSourceSha256: string,
  collections: AtomicCollectionReconciler,
): Promise<DisableResult> {
  return withLockedParticipants(slug, async (tx, collectionTx, context, participants) => {
    const now = new Date();
    if (context.currentVersion !== expectedVersion) {
      throw new Error(`Collection ${slug} current version changed before disablement`);
    }
    const actualSha256 = sourceMetadataSha256(context.sourceMetadata);
    if (!actualSha256 || actualSha256 !== expectedSourceSha256) {
      throw new Error(`Collection ${slug} source snapshot changed before disablement`);
    }
    if (context.lifecycleStatus === "disabled") {
      return {
        slug,
        lifecycleStatus: "disabled" as const,
        releasedAllocations: 0,
        clearedLocks: 0,
        reconciliation: { scanned: 0, repaired: 0, errors: 0, publishedEvents: 0 },
        committedEvents: [],
      };
    }

    const slotRows = await tx
      .select({ id: collectionSlots.id })
      .from(collectionSlots)
      .where(eq(collectionSlots.collectionVersionId, context.versionId));
    const slotIds = slotRows.map((slot) => slot.id);
    const released = await releaseAllocationsForSlots(tx, slotIds, now);
    const clearedLockRows = await tx.execute(sql`
      DELETE FROM holdings_locks AS lock
      USING user_collection_allocations AS allocation, collection_slots AS slot
      WHERE lock.lock_reference_id = allocation.lock_reference_id
        AND lock.lock_type = 'collection'
        AND allocation.collection_slot_id = slot.id
        AND slot.collection_version_id = ${context.versionId}
      RETURNING lock.id
    `);
    const releasedAllocations = released.releasedAllocations;
    const clearedLocks = released.clearedLocks + clearedLockRows.rows.length;

    await tx
      .update(collectionDefinitions)
      .set({
        lifecycleStatus: "disabled",
        disabledAt: now,
        disabledReason: reason,
        updatedAt: now,
      })
      .where(eq(collectionDefinitions.id, context.definitionId));

    const reconciliation = await collections.reconcileCandidatesInTransaction(
      collectionTx,
      participants,
      "membership_changed",
      now,
    );
    const membershipEvents = await recordMembershipChangedEventsInTransaction(
      tx,
      slug,
      context.versionId,
      participants,
      { disabledReason: reason, releasedAllocations, clearedLocks },
      "collection_disabled",
      now,
    );

    return {
      slug,
      lifecycleStatus: "disabled" as const,
      releasedAllocations,
      clearedLocks,
      reconciliation: publicReconciliationResult(reconciliation),
      committedEvents: [...reconciliation.events, ...membershipEvents],
    };
  });
}

export async function inspectMlbCatalog(): Promise<unknown[]> {
  const result = await db.execute(sql`
    SELECT
      definition.slug,
      definition.season,
      definition.family,
      definition.kind,
      definition.lifecycle_status,
      definition.current_version,
      version.id AS version_id,
      version.state AS version_state,
      version.source_metadata,
      COUNT(DISTINCT slot.id) FILTER (WHERE slot.status = 'active')::integer AS active_slot_count,
      COUNT(DISTINCT prerequisite.id)::integer AS prerequisite_count,
      COUNT(DISTINCT state.user_id) FILTER (WHERE state.assembly_state = 'active')::integer AS active_collector_count
    FROM collection_definitions definition
    JOIN collection_definition_versions version
      ON version.definition_id = definition.id
     AND version.version = definition.current_version
    LEFT JOIN collection_slots slot ON slot.collection_version_id = version.id
    LEFT JOIN collection_prerequisites prerequisite ON prerequisite.master_version_id = version.id
    LEFT JOIN user_collection_states state ON state.collection_version_id = version.id
    WHERE definition.sport = 'MLB'
    GROUP BY definition.id, version.id
    ORDER BY definition.season, definition.family, definition.slug
  `);
  return result.rows;
}

export function buildCollectionParticipationQuery(slug: string) {
  return sql`
    SELECT
      definition.slug,
      version.id AS version_id,
      COALESCE(state_counts.participant_count, 0)::integer AS participant_count,
      COALESCE(state_counts.active_collector_count, 0)::integer AS active_collector_count,
      COALESCE(award_counts.historical_completer_count, 0)::integer AS historical_completer_count,
      COALESCE(allocation_counts.allocating_user_count, 0)::integer AS allocating_user_count,
      COALESCE(allocation_counts.allocated_quantity, 0)::text AS allocated_quantity
    FROM collection_definitions definition
    JOIN collection_definition_versions version
      ON version.definition_id = definition.id
     AND version.version = definition.current_version
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT state.user_id) AS participant_count,
        COUNT(DISTINCT state.user_id) FILTER (WHERE state.assembly_state = 'active') AS active_collector_count
      FROM user_collection_states state
      WHERE state.collection_version_id = version.id
    ) state_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT award.user_id) AS historical_completer_count
      FROM user_collection_awards award
      WHERE award.collection_definition_id = definition.id
    ) award_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT allocation.user_id) AS allocating_user_count,
        SUM(allocation.allocated_quantity) AS allocated_quantity
      FROM collection_slots slot
      JOIN user_collection_allocations allocation
        ON allocation.collection_slot_id = slot.id
       AND allocation.status = 'active'
      WHERE slot.collection_version_id = version.id
    ) allocation_counts ON TRUE
    WHERE definition.slug = ${slug}
  `;
}

export async function getCollectionParticipation(slug: string): Promise<unknown> {
  const result = await db.execute(buildCollectionParticipationQuery(slug));
  const row = result.rows[0];
  if (!row) throw new Error(`Collection ${slug} was not found`);
  return row;
}
