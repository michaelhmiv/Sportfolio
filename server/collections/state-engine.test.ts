import { describe, expect, it } from "vitest";
import {
  CollectionDomainError,
  completeReadyCollection,
  deriveEvaluationEvent,
  evaluateCollectionProgress,
  normalizeCollectionQuantity,
  type CollectionProgressSnapshot,
} from "./state-engine";

function snapshot(
  assemblyState: CollectionProgressSnapshot["assemblyState"],
  overrides: Partial<CollectionProgressSnapshot> = {},
): CollectionProgressSnapshot {
  return {
    assemblyState,
    allocatedQuantity: "0.0000",
    requiredQuantity: "2.0000",
    qualifiedSlotCount: 0,
    requiredSlotCount: 2,
    progressBps: 0,
    readyAt: null,
    activatedAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

describe("collection quantity normalization", () => {
  it.each([
    ["1", "1.0000"],
    ["1.2", "1.2000"],
    ["0.0001", "0.0001"],
    ["9999999999999999.9999", "9999999999999999.9999"],
  ])("canonicalizes %s without floating-point conversion", (input, expected) => {
    expect(normalizeCollectionQuantity(input)).toBe(expected);
  });

  it.each(["0", "0.0000", "-1", "1e-4", "1.00001", "01", ".5", "10000000000000000"])(
    "rejects invalid or unpersistable quantity %s",
    (input) => {
      expect(() => normalizeCollectionQuantity(input)).toThrow(CollectionDomainError);
    },
  );
});

describe("collection progress evaluation", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");

  it("uses exact capped quantities and becomes ready only when every requirement is qualified", () => {
    const result = evaluateCollectionProgress({
      previous: snapshot("in_progress"),
      requirements: [
        { requiredQuantity: "1.0000", allocatedQuantity: "1.5000" },
        { requiredQuantity: "1.0000", allocatedQuantity: "0.5000" },
      ],
      now,
    });

    expect(result).toMatchObject({
      assemblyState: "in_progress",
      allocatedQuantity: "1.5000",
      requiredQuantity: "2.0000",
      qualifiedSlotCount: 1,
      requiredSlotCount: 2,
      progressBps: 7500,
    });
  });

  it("marks a fully assembled collection ready rather than auto-activating it", () => {
    const result = evaluateCollectionProgress({
      previous: snapshot("in_progress"),
      requirements: [
        { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
        { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
      ],
      now,
    });

    expect(result.assemblyState).toBe("ready");
    expect(result.readyAt).toEqual(now);
    expect(result.activatedAt).toBeNull();
  });

  it("deactivates an active collection when a requirement is lost", () => {
    const activatedAt = new Date("2026-07-01T00:00:00.000Z");
    const result = evaluateCollectionProgress({
      previous: snapshot("active", {
        allocatedQuantity: "2.0000",
        qualifiedSlotCount: 2,
        progressBps: 10000,
        activatedAt,
      }),
      requirements: [
        { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
        { requiredQuantity: "1.0000", allocatedQuantity: "0.0000" },
      ],
      now,
    });

    expect(result.assemblyState).toBe("inactive");
    expect(result.activatedAt).toEqual(activatedAt);
    expect(result.deactivatedAt).toEqual(now);
  });

  it("requires deliberate reactivation after an inactive collection is restored", () => {
    const deactivatedAt = new Date("2026-07-10T00:00:00.000Z");
    const result = evaluateCollectionProgress({
      previous: snapshot("inactive", { deactivatedAt }),
      requirements: [
        { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
        { requiredQuantity: "1.0000", allocatedQuantity: "1.0000" },
      ],
      now,
    });

    expect(result.assemblyState).toBe("ready");
    expect(result.deactivatedAt).toEqual(deactivatedAt);
  });

  it("never makes an empty definition ready", () => {
    const result = evaluateCollectionProgress({
      previous: null,
      requirements: [],
      now,
    });

    expect(result).toMatchObject({
      assemblyState: "unstarted",
      progressBps: 0,
      requiredSlotCount: 0,
    });
  });
});

describe("collection lifecycle events", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");

  it("emits ready, progress, and deactivation events only for meaningful changes", () => {
    const before = snapshot("in_progress", {
      allocatedQuantity: "1.0000",
      qualifiedSlotCount: 1,
      progressBps: 5000,
    });
    const ready = snapshot("ready", {
      allocatedQuantity: "2.0000",
      qualifiedSlotCount: 2,
      progressBps: 10000,
      readyAt: now,
    });

    expect(deriveEvaluationEvent(before, ready, "allocation_changed")?.eventType).toBe("ready");
    expect(deriveEvaluationEvent(before, before, "allocation_changed")).toBeNull();
    expect(
      deriveEvaluationEvent(before, { ...before, progressBps: 7500 }, "allocation_changed")
        ?.eventType,
    ).toBe("progress_changed");
    expect(
      deriveEvaluationEvent(
        snapshot("active", { activatedAt: now }),
        snapshot("inactive", { activatedAt: now, deactivatedAt: now }),
        "allocation_changed",
      )?.eventType,
    ).toBe("deactivated");
  });

  it("completes or reactivates only a ready collection", () => {
    const ready = snapshot("ready", { readyAt: now, progressBps: 10000 });

    expect(completeReadyCollection(ready, false, now)).toMatchObject({
      state: { assemblyState: "active", activatedAt: now },
      eventType: "completed",
    });
    expect(completeReadyCollection(ready, true, now)).toMatchObject({
      state: { assemblyState: "active", activatedAt: now },
      eventType: "reactivated",
    });
    expect(() => completeReadyCollection(snapshot("in_progress"), false, now)).toThrow(
      CollectionDomainError,
    );
  });
});
