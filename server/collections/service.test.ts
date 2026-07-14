import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CollectionBackendService,
  type CollectionDefinitionContext,
  type CollectionRepository,
  type CollectionTransaction,
} from "./service";
import { CollectionDomainError, type CollectionProgressSnapshot } from "./state-engine";

const now = new Date("2026-07-14T12:00:00.000Z");

const definition: CollectionDefinitionContext = {
  definitionId: "definition-1",
  slug: "mlb-2026-test",
  kind: "player_slots",
  lifecycleStatus: "tracking",
  currentVersion: 1,
  versionId: "version-1",
  version: 1,
  versionState: "tracking",
};

const readyState: CollectionProgressSnapshot = {
  assemblyState: "ready",
  allocatedQuantity: "2.0000",
  requiredQuantity: "2.0000",
  qualifiedSlotCount: 2,
  requiredSlotCount: 2,
  progressBps: 10000,
  readyAt: now,
  activatedAt: null,
  deactivatedAt: null,
};

function createHarness() {
  const transaction: CollectionTransaction = {
    lockUser: vi.fn().mockResolvedValue(undefined),
    getDefinitionBySlug: vi.fn().mockResolvedValue(definition),
    getDefinitionForVersion: vi.fn().mockResolvedValue(definition),
    getSlot: vi.fn().mockResolvedValue({
      slotId: "slot-1",
      definitionId: definition.definitionId,
      versionId: definition.versionId,
      playerId: "mlb_1",
      status: "active",
      requiredQuantity: "1.0000",
    }),
    getAllocation: vi.fn().mockResolvedValue(null),
    assertAvailableShares: vi.fn().mockResolvedValue(undefined),
    upsertAllocation: vi.fn().mockResolvedValue({
      allocationId: "allocation-1",
      lockReferenceId: "lock-reference-1",
      allocatedQuantity: "1.0000",
      status: "active",
    }),
    upsertCollectionLock: vi.fn().mockResolvedValue(undefined),
    releaseAllocation: vi.fn().mockResolvedValue(null),
    deleteCollectionLock: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    getRequirements: vi.fn().mockResolvedValue([
      { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
      { requiredQuantity: "1.0000", allocatedQuantity: "0.0000" },
    ]),
    upsertState: vi.fn().mockImplementation(async (_userId, _context, state) => state),
    appendStateEvent: vi.fn().mockResolvedValue("event-1"),
    getParentDefinitions: vi.fn().mockResolvedValue([]),
    getAward: vi.fn().mockResolvedValue(null),
    getNextCompletionSequence: vi.fn().mockResolvedValue(1),
    insertAward: vi.fn().mockResolvedValue({
      awardId: "award-1",
      firstCompletedAt: now,
      completionSequence: 1,
    }),
  };
  const repository: CollectionRepository = {
    transaction: vi.fn(async (callback) => callback(transaction)),
    listReconciliationCandidates: vi.fn().mockResolvedValue([]),
    listPlayerCandidates: vi.fn().mockResolvedValue([]),
    resolveEarnedBadgePreferences: vi.fn().mockResolvedValue([]),
  };
  const publish = vi.fn();
  const service = new CollectionBackendService(repository, { publish }, () => now);

  return { service, repository, transaction, publish };
}

describe("CollectionBackendService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets an absolute slot allocation and publishes the committed progress event", async () => {
    const { service, transaction, publish } = createHarness();

    const result = await service.setAllocation({
      userId: "user-1",
      slug: definition.slug,
      slotId: "slot-1",
      quantity: "1",
    });

    expect(transaction.lockUser).toHaveBeenCalledWith("user-1");
    expect(transaction.assertAvailableShares).toHaveBeenCalledWith({
      userId: "user-1",
      playerId: "mlb_1",
      quantity: "1.0000",
      excludingLockReferenceId: null,
    });
    expect(transaction.upsertCollectionLock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        playerId: "mlb_1",
        quantity: "1.0000",
      }),
    );
    expect(result.state).toMatchObject({
      assemblyState: "in_progress",
      allocatedQuantity: "1.0000",
      progressBps: 5000,
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", eventType: "progress_changed" }),
    );
  });

  it("rejects an allocation larger than the slot requirement before reserving shares", async () => {
    const { service, transaction } = createHarness();

    await expect(
      service.setAllocation({
        userId: "user-1",
        slug: definition.slug,
        slotId: "slot-1",
        quantity: "1.0001",
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_SLOT_REQUIREMENT" });

    expect(transaction.assertAvailableShares).not.toHaveBeenCalled();
  });

  it("rejects stale-version allocation writes with a machine-readable error", async () => {
    const { service, transaction } = createHarness();
    vi.mocked(transaction.getSlot).mockResolvedValueOnce({
      slotId: "slot-1",
      definitionId: definition.definitionId,
      versionId: "version-0",
      playerId: "mlb_1",
      status: "active",
      requiredQuantity: "1.0000",
    });

    await expect(
      service.setAllocation({
        userId: "user-1",
        slug: definition.slug,
        slotId: "slot-1",
        quantity: "1.0000",
      }),
    ).rejects.toMatchObject({ code: "DEFINITION_VERSION_CHANGED", status: 409 });
  });

  it("releases an allocation idempotently and evaluates the affected version", async () => {
    const { service, transaction } = createHarness();
    vi.mocked(transaction.releaseAllocation).mockResolvedValueOnce({
      allocationId: "allocation-1",
      lockReferenceId: "lock-reference-1",
      allocatedQuantity: "1.0000",
      status: "released",
    });

    const first = await service.releaseAllocation({
      userId: "user-1",
      slug: definition.slug,
      slotId: "slot-1",
    });
    vi.mocked(transaction.releaseAllocation).mockResolvedValueOnce(null);
    const second = await service.releaseAllocation({
      userId: "user-1",
      slug: definition.slug,
      slotId: "slot-1",
    });

    expect(transaction.deleteCollectionLock).toHaveBeenCalledWith("lock-reference-1");
    expect(first.state.assemblyState).toBe("in_progress");
    expect(second.state.assemblyState).toBe("in_progress");
  });

  it("deliberately completes a ready collection, inserts its first immutable award, and emits", async () => {
    const { service, transaction, publish } = createHarness();
    vi.mocked(transaction.getState).mockResolvedValue(readyState);
    vi.mocked(transaction.getRequirements).mockResolvedValue([
      { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
      { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
    ]);

    const result = await service.completeCollection({
      userId: "user-1",
      slug: definition.slug,
    });

    expect(result.state.assemblyState).toBe("active");
    expect(result.award).toMatchObject({ awardId: "award-1", completionSequence: 1 });
    expect(transaction.insertAward).toHaveBeenCalledOnce();
    expect(transaction.appendStateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "completed", nextState: "active" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "completed", userId: "user-1" }),
    );
  });

  it("reactivates without creating a second award", async () => {
    const { service, transaction } = createHarness();
    vi.mocked(transaction.getState).mockResolvedValue(readyState);
    vi.mocked(transaction.getRequirements).mockResolvedValue([
      { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
      { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
    ]);
    vi.mocked(transaction.getAward).mockResolvedValue({
      awardId: "award-1",
      firstCompletedAt: new Date("2026-07-01T00:00:00.000Z"),
      completionSequence: 1,
    });

    const result = await service.completeCollection({
      userId: "user-1",
      slug: definition.slug,
    });

    expect(result.eventType).toBe("reactivated");
    expect(transaction.insertAward).not.toHaveBeenCalled();
  });

  it("treats repeated completion of an active collection as an idempotent no-op", async () => {
    const { service, transaction, publish } = createHarness();
    const activeState: CollectionProgressSnapshot = {
      ...readyState,
      assemblyState: "active",
      activatedAt: new Date("2026-07-01T00:00:00.000Z"),
    };
    const award = {
      awardId: "award-1",
      firstCompletedAt: new Date("2026-07-01T00:00:00.000Z"),
      completionSequence: 1,
    };
    vi.mocked(transaction.getState).mockResolvedValue(activeState);
    vi.mocked(transaction.getRequirements).mockResolvedValue([
      { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
      { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
    ]);
    vi.mocked(transaction.getAward).mockResolvedValue(award);

    await expect(
      service.completeCollection({ userId: "user-1", slug: definition.slug }),
    ).resolves.toEqual({ state: activeState, award, eventType: "already_active" });
    expect(transaction.insertAward).not.toHaveBeenCalled();
    expect(transaction.appendStateEvent).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("reevaluates shared ancestors after every changed parent in a dependency diamond", async () => {
    const { service, transaction } = createHarness();
    const contexts = Object.fromEntries([
      ["version-1", definition],
      [
        "parent-1",
        {
          ...definition,
          definitionId: "parent-definition-1",
          slug: "parent-1",
          kind: "master" as const,
          versionId: "parent-1",
        },
      ],
      [
        "parent-2",
        {
          ...definition,
          definitionId: "parent-definition-2",
          slug: "parent-2",
          kind: "master" as const,
          versionId: "parent-2",
        },
      ],
      [
        "grandparent",
        {
          ...definition,
          definitionId: "grandparent-definition",
          slug: "grandparent",
          kind: "master" as const,
          versionId: "grandparent",
        },
      ],
    ] as const) as Record<string, CollectionDefinitionContext>;
    const states = new Map<string, CollectionProgressSnapshot>([
      [
        "version-1",
        {
          ...readyState,
          requiredQuantity: "1.0000",
          requiredSlotCount: 1,
          qualifiedSlotCount: 1,
          assemblyState: "active",
          activatedAt: now,
        },
      ],
      [
        "parent-1",
        {
          ...readyState,
          requiredQuantity: "1.0000",
          requiredSlotCount: 1,
          qualifiedSlotCount: 1,
          assemblyState: "active",
          activatedAt: now,
        },
      ],
      [
        "parent-2",
        {
          ...readyState,
          requiredQuantity: "1.0000",
          requiredSlotCount: 1,
          qualifiedSlotCount: 1,
          assemblyState: "active",
          activatedAt: now,
        },
      ],
      [
        "grandparent",
        {
          ...readyState,
          assemblyState: "active",
          activatedAt: now,
        },
      ],
    ]);

    vi.mocked(transaction.getState).mockImplementation(
      async (_userId, versionId) => states.get(versionId) || null,
    );
    vi.mocked(transaction.getRequirements).mockImplementation(async (_userId, context) => {
      if (context.versionId === "version-1") {
        return [{ requiredQuantity: "1.0000", allocatedQuantity: "0.5000" }];
      }
      if (context.versionId === "grandparent") {
        return ["parent-1", "parent-2"].map((versionId) => ({
          requiredQuantity: "1.0000",
          allocatedQuantity:
            states.get(versionId)?.assemblyState === "active" ? "1.0000" : "0.0000",
        }));
      }
      return [
        {
          requiredQuantity: "1.0000",
          allocatedQuantity:
            states.get("version-1")?.assemblyState === "active" ? "1.0000" : "0.0000",
        },
      ];
    });
    vi.mocked(transaction.upsertState).mockImplementation(async (_userId, context, state) => {
      states.set(context.versionId, state);
      return state;
    });
    vi.mocked(transaction.getParentDefinitions).mockImplementation(async (versionId) => {
      if (versionId === "version-1") return [contexts["parent-1"], contexts["parent-2"]];
      if (versionId === "parent-1" || versionId === "parent-2") {
        return [contexts.grandparent];
      }
      return [];
    });

    await service.setAllocation({
      userId: "user-1",
      slug: definition.slug,
      slotId: "slot-1",
      quantity: "0.5000",
    });

    const grandparentWrites = vi
      .mocked(transaction.upsertState)
      .mock.calls.filter(([, context]) => context.versionId === "grandparent");
    expect(grandparentWrites).toHaveLength(2);
    expect(states.get("grandparent")).toMatchObject({
      allocatedQuantity: "0.0000",
      qualifiedSlotCount: 0,
      progressBps: 0,
    });
  });

  it("preserves machine-readable domain errors", async () => {
    const { service, transaction } = createHarness();
    vi.mocked(transaction.assertAvailableShares).mockRejectedValueOnce(
      new CollectionDomainError(
        "INSUFFICIENT_AVAILABLE_SHARES",
        "Insufficient available shares",
        409,
      ),
    );

    await expect(
      service.setAllocation({
        userId: "user-1",
        slug: definition.slug,
        slotId: "slot-1",
        quantity: "1",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_AVAILABLE_SHARES", status: 409 });
  });
});
