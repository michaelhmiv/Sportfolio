import { randomUUID } from "node:crypto";
import {
  CollectionDomainError,
  compareCollectionQuantities,
  completeReadyCollection,
  deriveEvaluationEvent,
  evaluateCollectionProgress,
  normalizeCollectionQuantity,
  type CollectionAssemblyState,
  type CollectionProgressSnapshot,
  type CollectionRequirementProgress,
  type CollectionStateEventType,
} from "./state-engine";

export interface CollectionDefinitionContext {
  definitionId: string;
  slug: string;
  kind: "player_slots" | "master";
  lifecycleStatus: string;
  currentVersion: number;
  versionId: string;
  version: number;
  versionState: string;
}

export interface CollectionSlotContext {
  slotId: string;
  definitionId: string;
  versionId: string;
  playerId: string | null;
  status: string;
  requiredQuantity: string;
}

export interface CollectionAllocationRecord {
  allocationId: string;
  lockReferenceId: string;
  allocatedQuantity: string;
  status: "active" | "released";
}

export interface CollectionAwardRecord {
  awardId: string;
  firstCompletedAt: Date;
  completionSequence: number | null;
}

export interface CollectionStateEventInput {
  userId: string;
  definitionId: string;
  versionId: string;
  eventType: CollectionStateEventType;
  previousState: CollectionAssemblyState | null;
  nextState: CollectionAssemblyState;
  reason: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface CollectionEventPayload extends CollectionStateEventInput {
  eventId: string;
}

export interface CollectionTransaction {
  lockUser(userId: string): Promise<void>;
  getDefinitionBySlug(slug: string): Promise<CollectionDefinitionContext | null>;
  getDefinitionForVersion(versionId: string): Promise<CollectionDefinitionContext | null>;
  getSlot(slotId: string): Promise<CollectionSlotContext | null>;
  getAllocation(userId: string, slotId: string): Promise<CollectionAllocationRecord | null>;
  assertAvailableShares(input: {
    userId: string;
    playerId: string;
    quantity: string;
    excludingLockReferenceId: string | null;
  }): Promise<void>;
  upsertAllocation(input: {
    userId: string;
    slot: CollectionSlotContext;
    quantity: string;
    lockReferenceId: string;
    now: Date;
  }): Promise<CollectionAllocationRecord>;
  upsertCollectionLock(input: {
    userId: string;
    playerId: string;
    lockReferenceId: string;
    quantity: string;
  }): Promise<void>;
  releaseAllocation(input: {
    userId: string;
    slotId: string;
    now: Date;
  }): Promise<CollectionAllocationRecord | null>;
  deleteCollectionLock(lockReferenceId: string): Promise<void>;
  getState(userId: string, versionId: string): Promise<CollectionProgressSnapshot | null>;
  getRequirements(
    userId: string,
    context: CollectionDefinitionContext,
  ): Promise<CollectionRequirementProgress[]>;
  upsertState(
    userId: string,
    context: CollectionDefinitionContext,
    state: CollectionProgressSnapshot,
    now: Date,
  ): Promise<CollectionProgressSnapshot>;
  appendStateEvent(event: CollectionStateEventInput): Promise<string>;
  getParentDefinitions(versionId: string): Promise<CollectionDefinitionContext[]>;
  getAward(userId: string, versionId: string): Promise<CollectionAwardRecord | null>;
  getNextCompletionSequence(userId: string): Promise<number>;
  insertAward(input: {
    userId: string;
    context: CollectionDefinitionContext;
    firstCompletedAt: Date;
    completionSequence: number;
  }): Promise<CollectionAwardRecord>;
}

export interface CollectionReconciliationCandidate {
  userId: string;
  versionId: string;
}

export interface EarnedBadgePreference {
  definitionId: string;
  slug: string;
  title: string;
  artKey: string;
  priority: number;
  firstCompletedAt: Date;
}

export interface CollectionRepository {
  transaction<T>(callback: (tx: CollectionTransaction) => Promise<T>): Promise<T>;
  listReconciliationCandidates(limit: number): Promise<CollectionReconciliationCandidate[]>;
  listPlayerCandidates(
    userId: string,
    playerId: string,
  ): Promise<CollectionReconciliationCandidate[]>;
  resolveEarnedBadgePreferences(userId: string, limit: number): Promise<EarnedBadgePreference[]>;
}

export interface CollectionEventPublisher {
  publish(event: CollectionEventPayload): Promise<void> | void;
}

interface TransactionResult<T> {
  value: T;
  events: CollectionEventPayload[];
}

function assertDefinitionAvailable(context: CollectionDefinitionContext): void {
  const definitionAvailable =
    context.lifecycleStatus === "tracking" || context.lifecycleStatus === "final";
  const versionAvailable = context.versionState === "tracking" || context.versionState === "final";
  if (!definitionAvailable || !versionAvailable) {
    throw new CollectionDomainError(
      "COLLECTION_UNAVAILABLE",
      "Collection is not available for assembly",
      409,
      {
        lifecycleStatus: context.lifecycleStatus,
        versionState: context.versionState,
      },
    );
  }
}

function requireDefinition(
  context: CollectionDefinitionContext | null,
  slug: string,
): CollectionDefinitionContext {
  if (!context) {
    throw new CollectionDomainError("COLLECTION_NOT_FOUND", "Collection was not found", 404, {
      slug,
    });
  }
  return context;
}

export class CollectionBackendService {
  constructor(
    private readonly repository: CollectionRepository,
    private readonly publisher: CollectionEventPublisher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async setAllocation(input: {
    userId: string;
    slug: string;
    slotId: string;
    quantity: string;
  }): Promise<{ allocation: CollectionAllocationRecord; state: CollectionProgressSnapshot }> {
    const quantity = normalizeCollectionQuantity(input.quantity);
    const committed = await this.repository.transaction(async (tx) => {
      const now = this.clock();
      const events: CollectionEventPayload[] = [];
      await tx.lockUser(input.userId);
      const context = requireDefinition(await tx.getDefinitionBySlug(input.slug), input.slug);
      assertDefinitionAvailable(context);
      const slot = await tx.getSlot(input.slotId);
      this.assertSlotForDefinition(slot, context);

      if (slot.versionId !== context.versionId) {
        throw new CollectionDomainError(
          "DEFINITION_VERSION_CHANGED",
          "The requested slot is not part of the current collection version",
          409,
          { requestedVersionId: slot.versionId, currentVersionId: context.versionId },
        );
      }
      if (slot.status !== "active" || !slot.playerId) {
        throw new CollectionDomainError(
          "SLOT_UNAVAILABLE",
          "Collection slot is not allocatable",
          409,
        );
      }
      if (compareCollectionQuantities(quantity, slot.requiredQuantity) > 0) {
        throw new CollectionDomainError(
          "ALLOCATION_EXCEEDS_SLOT_REQUIREMENT",
          "Allocation cannot exceed the slot requirement",
          409,
          { requiredQuantity: slot.requiredQuantity },
        );
      }

      const existing = await tx.getAllocation(input.userId, slot.slotId);
      const lockReferenceId = existing?.lockReferenceId || randomUUID();
      await tx.assertAvailableShares({
        userId: input.userId,
        playerId: slot.playerId,
        quantity,
        excludingLockReferenceId: existing?.lockReferenceId || null,
      });
      const allocation = await tx.upsertAllocation({
        userId: input.userId,
        slot,
        quantity,
        lockReferenceId,
        now,
      });
      await tx.upsertCollectionLock({
        userId: input.userId,
        playerId: slot.playerId,
        lockReferenceId,
        quantity,
      });
      const state = await this.evaluateVersion(
        tx,
        input.userId,
        context,
        "allocation_changed",
        now,
        events,
        new Set(),
      );
      return { value: { allocation, state }, events };
    });

    await this.publishCommittedEvents(committed.events);
    return committed.value;
  }

  async releaseAllocation(input: { userId: string; slug: string; slotId: string }): Promise<{
    allocation: CollectionAllocationRecord | null;
    state: CollectionProgressSnapshot;
  }> {
    const committed = await this.repository.transaction(async (tx) => {
      const now = this.clock();
      const events: CollectionEventPayload[] = [];
      await tx.lockUser(input.userId);
      const currentContext = requireDefinition(
        await tx.getDefinitionBySlug(input.slug),
        input.slug,
      );
      const slot = await tx.getSlot(input.slotId);
      this.assertSlotForDefinition(slot, currentContext);
      const context = requireDefinition(
        await tx.getDefinitionForVersion(slot.versionId),
        input.slug,
      );
      if (context.definitionId !== currentContext.definitionId) {
        throw new CollectionDomainError("SLOT_NOT_FOUND", "Collection slot was not found", 404);
      }

      const allocation = await tx.releaseAllocation({
        userId: input.userId,
        slotId: slot.slotId,
        now,
      });
      if (allocation) {
        await tx.deleteCollectionLock(allocation.lockReferenceId);
      }
      const state = await this.evaluateVersion(
        tx,
        input.userId,
        context,
        "allocation_released",
        now,
        events,
        new Set(),
      );
      return { value: { allocation, state }, events };
    });

    await this.publishCommittedEvents(committed.events);
    return committed.value;
  }

  async completeCollection(input: { userId: string; slug: string }): Promise<{
    state: CollectionProgressSnapshot;
    award: CollectionAwardRecord;
    eventType: "completed" | "reactivated" | "already_active";
  }> {
    const committed = await this.repository.transaction(async (tx) => {
      const now = this.clock();
      const events: CollectionEventPayload[] = [];
      await tx.lockUser(input.userId);
      const context = requireDefinition(await tx.getDefinitionBySlug(input.slug), input.slug);
      assertDefinitionAvailable(context);
      const evaluated = await this.evaluateVersion(
        tx,
        input.userId,
        context,
        "completion_requested",
        now,
        events,
        new Set(),
      );
      const existingAward = await tx.getAward(input.userId, context.versionId);
      if (evaluated.assemblyState === "active") {
        if (!existingAward) {
          throw new CollectionDomainError(
            "COLLECTION_INTEGRITY_CONFLICT",
            "Active collection is missing its completion award",
            409,
          );
        }
        return {
          value: { state: evaluated, award: existingAward, eventType: "already_active" as const },
          events,
        };
      }

      const completion = completeReadyCollection(evaluated, Boolean(existingAward), now);
      const state = await tx.upsertState(input.userId, context, completion.state, now);
      const award =
        existingAward ||
        (await tx.insertAward({
          userId: input.userId,
          context,
          firstCompletedAt: now,
          completionSequence: await tx.getNextCompletionSequence(input.userId),
        }));
      const event = await this.appendEvent(tx, events, {
        userId: input.userId,
        definitionId: context.definitionId,
        versionId: context.versionId,
        eventType: completion.eventType,
        previousState: evaluated.assemblyState,
        nextState: state.assemblyState,
        reason: "completion_requested",
        metadata: { awardId: award.awardId },
        occurredAt: now,
      });
      events.push(event);
      await this.evaluateParents(
        tx,
        input.userId,
        context.versionId,
        "prerequisite_activated",
        now,
        events,
        new Set([context.versionId]),
      );
      return {
        value: { state, award, eventType: completion.eventType },
        events,
      };
    });

    await this.publishCommittedEvents(committed.events);
    return committed.value;
  }

  async reconcileAll(limit = 500): Promise<{
    scanned: number;
    repaired: number;
    errors: number;
    publishedEvents: number;
  }> {
    const candidates = await this.repository.listReconciliationCandidates(limit);
    let repaired = 0;
    let errors = 0;
    let publishedEvents = 0;

    for (const candidate of candidates) {
      try {
        const committed = await this.reconcileCandidate(candidate, "reconciliation");
        repaired += committed.events.length > 0 ? 1 : 0;
        publishedEvents += committed.events.length;
        await this.publishCommittedEvents(committed.events);
      } catch {
        errors += 1;
      }
    }

    return { scanned: candidates.length, repaired, errors, publishedEvents };
  }

  async reconcile(limit = 500): Promise<{
    candidates: number;
    changed: number;
    errors: number;
  }> {
    const result = await this.reconcileAll(limit);
    return {
      candidates: result.scanned,
      changed: result.repaired,
      errors: result.errors,
    };
  }

  async reevaluateForPlayer(userId: string, playerId: string): Promise<number> {
    const candidates = await this.repository.listPlayerCandidates(userId, playerId);
    let changed = 0;
    for (const candidate of candidates) {
      const committed = await this.reconcileCandidate(candidate, "ownership_changed");
      changed += committed.events.length > 0 ? 1 : 0;
      await this.publishCommittedEvents(committed.events);
    }
    return changed;
  }

  resolveEarnedBadgePreferences(userId: string, limit = 3): Promise<EarnedBadgePreference[]> {
    return this.repository.resolveEarnedBadgePreferences(userId, limit);
  }

  private async reconcileCandidate(
    candidate: CollectionReconciliationCandidate,
    reason: string,
  ): Promise<TransactionResult<CollectionProgressSnapshot>> {
    return this.repository.transaction(async (tx) => {
      const now = this.clock();
      const events: CollectionEventPayload[] = [];
      await tx.lockUser(candidate.userId);
      const context = await tx.getDefinitionForVersion(candidate.versionId);
      if (!context) {
        throw new CollectionDomainError(
          "COLLECTION_VERSION_NOT_FOUND",
          "Collection version was not found",
          404,
          { versionId: candidate.versionId },
        );
      }
      const state = await this.evaluateVersion(
        tx,
        candidate.userId,
        context,
        reason,
        now,
        events,
        new Set(),
      );
      return { value: state, events };
    });
  }

  private assertSlotForDefinition(
    slot: CollectionSlotContext | null,
    context: CollectionDefinitionContext,
  ): asserts slot is CollectionSlotContext {
    if (!slot || slot.definitionId !== context.definitionId) {
      throw new CollectionDomainError("SLOT_NOT_FOUND", "Collection slot was not found", 404);
    }
  }

  private async evaluateVersion(
    tx: CollectionTransaction,
    userId: string,
    context: CollectionDefinitionContext,
    reason: string,
    now: Date,
    events: CollectionEventPayload[],
    visited: Set<string>,
  ): Promise<CollectionProgressSnapshot> {
    if (visited.has(context.versionId)) {
      const existing = await tx.getState(userId, context.versionId);
      if (!existing) {
        throw new CollectionDomainError(
          "COLLECTION_DEPENDENCY_CYCLE",
          "Collection dependency cycle prevented evaluation",
          409,
        );
      }
      return existing;
    }
    const path = new Set(visited);
    path.add(context.versionId);

    const previous = await tx.getState(userId, context.versionId);
    const requirements = await tx.getRequirements(userId, context);
    const evaluated = evaluateCollectionProgress({ previous, requirements, now });
    const state = await tx.upsertState(userId, context, evaluated, now);
    const derivedEvent = deriveEvaluationEvent(previous, state, reason);
    if (derivedEvent) {
      events.push(
        await this.appendEvent(tx, events, {
          userId,
          definitionId: context.definitionId,
          versionId: context.versionId,
          ...derivedEvent,
          metadata: {
            progressBps: state.progressBps,
            qualifiedSlotCount: state.qualifiedSlotCount,
            requiredSlotCount: state.requiredSlotCount,
          },
          occurredAt: now,
        }),
      );
    }

    const activeChanged =
      (previous?.assemblyState === "active") !== (state.assemblyState === "active");
    if (activeChanged) {
      await this.evaluateParents(
        tx,
        userId,
        context.versionId,
        state.assemblyState === "active" ? "prerequisite_activated" : "prerequisite_deactivated",
        now,
        events,
        path,
      );
    }
    return state;
  }

  private async evaluateParents(
    tx: CollectionTransaction,
    userId: string,
    versionId: string,
    reason: string,
    now: Date,
    events: CollectionEventPayload[],
    visited: Set<string>,
  ): Promise<void> {
    const parents = (await tx.getParentDefinitions(versionId)).sort((left, right) =>
      left.versionId.localeCompare(right.versionId),
    );
    for (const parent of parents) {
      await this.evaluateVersion(tx, userId, parent, reason, now, events, visited);
    }
  }

  private async appendEvent(
    tx: CollectionTransaction,
    _events: CollectionEventPayload[],
    event: CollectionStateEventInput,
  ): Promise<CollectionEventPayload> {
    const eventId = await tx.appendStateEvent(event);
    return { ...event, eventId };
  }

  private async publishCommittedEvents(events: CollectionEventPayload[]): Promise<void> {
    await Promise.allSettled(events.map((event) => Promise.resolve(this.publisher.publish(event))));
  }
}
