export type CollectionAssemblyState = "unstarted" | "in_progress" | "ready" | "active" | "inactive";

export type CollectionStateEventType =
  | "progress_changed"
  | "ready"
  | "completed"
  | "deactivated"
  | "reactivated"
  | "membership_changed";

export class CollectionDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CollectionDomainError";
  }
}

export interface CollectionProgressSnapshot {
  assemblyState: CollectionAssemblyState;
  allocatedQuantity: string;
  requiredQuantity: string;
  qualifiedSlotCount: number;
  requiredSlotCount: number;
  progressBps: number;
  readyAt: Date | null;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
}

export interface CollectionRequirementProgress {
  requiredQuantity: string;
  allocatedQuantity: string;
}

export interface CollectionEvaluationEvent {
  eventType: CollectionStateEventType;
  previousState: CollectionAssemblyState | null;
  nextState: CollectionAssemblyState;
  reason: string;
}

const QUANTITY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,4}))?$/;
const QUANTITY_SCALE = 10_000n;

function parseQuantityUnits(value: string, allowZero: boolean): bigint {
  const match = QUANTITY_PATTERN.exec(value);
  if (!match) {
    throw new CollectionDomainError(
      "INVALID_QUANTITY",
      "Quantity must be a plain positive decimal with at most four fractional digits",
      400,
    );
  }

  const integerUnits = BigInt(match[1]) * QUANTITY_SCALE;
  const fractionalUnits = BigInt((match[2] || "").padEnd(4, "0") || "0");
  const units = integerUnits + fractionalUnits;

  if (!allowZero && units === 0n) {
    throw new CollectionDomainError("INVALID_QUANTITY", "Quantity must be greater than zero", 400);
  }

  return units;
}

function formatQuantityUnits(units: bigint): string {
  const integerPart = units / QUANTITY_SCALE;
  const fractionalPart = (units % QUANTITY_SCALE).toString().padStart(4, "0");
  return `${integerPart}.${fractionalPart}`;
}

export function normalizeCollectionQuantity(value: string): string {
  return formatQuantityUnits(parseQuantityUnits(value, false));
}

export function compareCollectionQuantities(left: string, right: string): -1 | 0 | 1 {
  const leftUnits = parseQuantityUnits(left, true);
  const rightUnits = parseQuantityUnits(right, true);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

function normalizedUnits(value: string): bigint {
  return parseQuantityUnits(value, true);
}

function deriveAssemblyState(
  previousState: CollectionAssemblyState | null,
  isComplete: boolean,
  allocatedUnits: bigint,
): CollectionAssemblyState {
  if (previousState === "active") {
    return isComplete ? "active" : "inactive";
  }

  if (previousState === "inactive") {
    return isComplete ? "ready" : "inactive";
  }

  if (isComplete) {
    return "ready";
  }

  return allocatedUnits > 0n ? "in_progress" : "unstarted";
}

export function evaluateCollectionProgress(input: {
  previous: CollectionProgressSnapshot | null;
  requirements: CollectionRequirementProgress[];
  now: Date;
}): CollectionProgressSnapshot {
  let allocatedUnits = 0n;
  let requiredUnits = 0n;
  let qualifiedSlotCount = 0;

  for (const requirement of input.requirements) {
    const required = normalizedUnits(requirement.requiredQuantity);
    const allocated = normalizedUnits(requirement.allocatedQuantity);
    requiredUnits += required;
    allocatedUnits += allocated < required ? allocated : required;
    if (required > 0n && allocated >= required) {
      qualifiedSlotCount += 1;
    }
  }

  const requiredSlotCount = input.requirements.length;
  const isComplete = requiredSlotCount > 0 && qualifiedSlotCount === requiredSlotCount;
  const assemblyState = deriveAssemblyState(
    input.previous?.assemblyState || null,
    isComplete,
    allocatedUnits,
  );
  const progressBps = requiredUnits > 0n ? Number((allocatedUnits * 10_000n) / requiredUnits) : 0;

  const becameReady = assemblyState === "ready" && input.previous?.assemblyState !== "ready";
  const becameInactive =
    assemblyState === "inactive" && input.previous?.assemblyState !== "inactive";

  return {
    assemblyState,
    allocatedQuantity: formatQuantityUnits(allocatedUnits),
    requiredQuantity: formatQuantityUnits(requiredUnits),
    qualifiedSlotCount,
    requiredSlotCount,
    progressBps,
    readyAt: becameReady ? input.now : input.previous?.readyAt || null,
    activatedAt: input.previous?.activatedAt || null,
    deactivatedAt: becameInactive ? input.now : input.previous?.deactivatedAt || null,
  };
}

function progressMetricsChanged(
  previous: CollectionProgressSnapshot,
  next: CollectionProgressSnapshot,
): boolean {
  return (
    previous.allocatedQuantity !== next.allocatedQuantity ||
    previous.requiredQuantity !== next.requiredQuantity ||
    previous.qualifiedSlotCount !== next.qualifiedSlotCount ||
    previous.requiredSlotCount !== next.requiredSlotCount ||
    previous.progressBps !== next.progressBps
  );
}

export function deriveEvaluationEvent(
  previous: CollectionProgressSnapshot | null,
  next: CollectionProgressSnapshot,
  reason: string,
): CollectionEvaluationEvent | null {
  if (previous?.assemblyState === next.assemblyState && !progressMetricsChanged(previous, next)) {
    return null;
  }

  let eventType: CollectionStateEventType = "progress_changed";
  if (next.assemblyState === "ready" && previous?.assemblyState !== "ready") {
    eventType = "ready";
  } else if (next.assemblyState === "inactive" && previous?.assemblyState !== "inactive") {
    eventType = "deactivated";
  }

  return {
    eventType,
    previousState: previous?.assemblyState || null,
    nextState: next.assemblyState,
    reason,
  };
}

export function completeReadyCollection(
  previous: CollectionProgressSnapshot,
  hasPriorAward: boolean,
  now: Date,
): {
  state: CollectionProgressSnapshot;
  eventType: "completed" | "reactivated";
} {
  if (previous.assemblyState !== "ready" || previous.progressBps !== 10_000) {
    throw new CollectionDomainError(
      "COLLECTION_NOT_READY",
      "Collection requirements must be fully allocated before completion",
      409,
    );
  }

  return {
    state: {
      ...previous,
      assemblyState: "active",
      activatedAt: now,
    },
    eventType: hasPriorAward ? "reactivated" : "completed",
  };
}
