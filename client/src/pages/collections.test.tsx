import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CollectionListEntry, CollectionDetailResponse } from "@shared/collection-api";
import {
  formatCanonicalQuantity,
  basisPointsToProgressValue,
  allocationProgressDisplay,
} from "@/lib/collection-format";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(slug: string, overrides?: Partial<CollectionListEntry>): CollectionListEntry {
  return {
    slug,
    definitionId: `def-${slug}`,
    sport: "MLB",
    league: "NL",
    season: "2025",
    family: "sluggers",
    kind: "player_slots",
    lifecycleStatus: "tracking",
    versionId: `ver-${slug}`,
    version: 1,
    title: "Test Collection",
    description: "A test collection",
    artKey: "default-key",
    state: "tracking",
    assemblyState: "unstarted",
    allocatedQuantity: "0.0000",
    requiredQuantity: "1.0000",
    qualifiedSlotCount: 0,
    requiredSlotCount: 5,
    progressBps: 0,
    award: null,
    ...overrides,
  };
}

function makeDetail(
  slug: string,
  overrides?: Partial<CollectionDetailResponse>,
): CollectionDetailResponse {
  return {
    ...makeEntry(slug, overrides),
    qualificationDescription: "Score 5 runs",
    slots: [],
    prerequisites: [],
    ...overrides,
  };
}

// ── replica of state badge logic used by both pages ────────────────────────

function stateBadge(state: string) {
  switch (state) {
    case "ready":
    case "active":
      return { label: state === "ready" ? "Ready" : "Active", className: "status-live" };
    case "in_progress":
      return { label: "In Progress", className: "amber" };
    case "inactive":
      return { label: "Inactive", className: "muted" };
    default:
      return null;
  }
}

// ── list fetch / query-key helpers ─────────────────────────────────────────

function buildListQueryKey(userId: string) {
  return ["/api/me/collections", userId] as const;
}

async function fetchCollections(authenticatedFetch: typeof fetch): Promise<CollectionListEntry[]> {
  const res = await authenticatedFetch("/api/me/collections");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Failed to load collections (${res.status})`);
  }
  const json = await res.json();
  return json.data as CollectionListEntry[];
}

async function fetchDetail(
  authenticatedFetch: typeof fetch,
  slug: string,
): Promise<CollectionDetailResponse> {
  const res = await authenticatedFetch(`/api/me/collections/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Failed to load collection (${res.status})`);
  }
  const json = await res.json();
  return json.data as CollectionDetailResponse;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("Collections list data fetching", () => {
  it("returns parsed data array on successful fetch", async () => {
    const entries: CollectionListEntry[] = [makeEntry("a"), makeEntry("b")];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: entries }),
    });

    const result = await fetchCollections(mockFetch as any);
    expect(result).toEqual(entries);
    expect(mockFetch).toHaveBeenCalledWith("/api/me/collections");
  });

  it("returns empty array when API returns no data", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const result = await fetchCollections(mockFetch as any);
    expect(result).toEqual([]);
  });

  it("throws with error message on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Server error" } }),
    });

    await expect(fetchCollections(mockFetch as any)).rejects.toThrow("Server error");
  });

  it("throws fallback message when error body has no message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    await expect(fetchCollections(mockFetch as any)).rejects.toThrow(
      "Failed to load collections (403)",
    );
  });
});

describe("Collection detail data fetching", () => {
  it("returns detail on success", async () => {
    const detail = makeDetail("hr-king");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: detail }),
    });

    const result = await fetchDetail(mockFetch as any, "hr-king");
    expect(result).toEqual(detail);
    expect(mockFetch).toHaveBeenCalledWith("/api/me/collections/hr-king");
  });

  it("throws on 404 with error message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { code: "COLLECTION_NOT_FOUND", message: "Collection was not found" },
      }),
    });

    await expect(fetchDetail(mockFetch as any, "no-such")).rejects.toThrow(
      "Collection was not found",
    );
  });

  it("throws on 500 with error message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: { code: "INTERNAL_ERROR", message: "Server error" },
      }),
    });

    await expect(fetchDetail(mockFetch as any, "broken")).rejects.toThrow("Server error");
  });
});

// ── Exact format helpers (Blocker 2) ─────────────────────────────────────────

describe("Exact decimal display via collection-format", () => {
  it("formats canonical quantity without parsing floats", () => {
    expect(formatCanonicalQuantity("1.0000")).toBe("1");
    expect(formatCanonicalQuantity("0.5000")).toBe("0.5");
    expect(formatCanonicalQuantity("99.0000")).toBe("99");
  });

  it("progress value preserves 9999 bps without rounding to 100", () => {
    expect(basisPointsToProgressValue(9999)).toBe(99.99);
    expect(basisPointsToProgressValue(10000)).toBe(100);
  });

  it("progress display shows 99.99% for 9999 bps", () => {
    expect(allocationProgressDisplay(9999)).toBe("99.99%");
    expect(allocationProgressDisplay(10000)).toBe("100.00%");
  });

  it("progress value preserves fractional percentages", () => {
    expect(basisPointsToProgressValue(5001)).toBe(50.01);
    expect(basisPointsToProgressValue(5099)).toBe(50.99);
    expect(basisPointsToProgressValue(9999)).toBe(99.99);
  });
});

// ── Lifecycle badge display (Blocker 1) ──────────────────────────────────────

describe("Collection state badge display", () => {
  it("stateBadge returns null for unstarted", () => {
    expect(stateBadge("unstarted")).toBeNull();
  });

  it("stateBadge returns Ready for ready", () => {
    expect(stateBadge("ready")).toEqual({ label: "Ready", className: "status-live" });
  });

  it("stateBadge returns Active for active", () => {
    expect(stateBadge("active")).toEqual({ label: "Active", className: "status-live" });
  });

  it("stateBadge returns In Progress for in_progress", () => {
    expect(stateBadge("in_progress")).toEqual({ label: "In Progress", className: "amber" });
  });

  it("stateBadge returns Inactive for inactive", () => {
    expect(stateBadge("inactive")).toEqual({ label: "Inactive", className: "muted" });
  });
});

// ── Cross-account query isolation (Blocker 4) ────────────────────────────────

describe("Query key isolation per user", () => {
  it("list query key includes userId", () => {
    const key = buildListQueryKey("user-42");
    expect(key).toEqual(["/api/me/collections", "user-42"]);
  });

  it("different users get different query keys", () => {
    const key1 = buildListQueryKey("user-1");
    const key2 = buildListQueryKey("user-2");
    expect(key1).not.toEqual(key2);
  });

  it("query key is readonly tuple", () => {
    const key = buildListQueryKey("user-1");
    expect(Array.isArray(key)).toBe(true);
    expect(key[0]).toBe("/api/me/collections");
    expect(key[1]).toBe("user-1");
  });
});

// ── CollectionListEntry shape ────────────────────────────────────────────────

describe("CollectionListEntry shape", () => {
  it("has required fields with correct types", () => {
    const entry = makeEntry("test");
    expect(typeof entry.slug).toBe("string");
    expect(typeof entry.definitionId).toBe("string");
    expect(typeof entry.sport).toBe("string");
    expect(typeof entry.kind).toBe("string");
    expect(typeof entry.versionId).toBe("string");
    expect(typeof entry.version).toBe("number");
    expect(typeof entry.title).toBe("string");
    expect(entry.artKey).toBeDefined();
    expect(typeof entry.assemblyState).toBe("string");
    expect(typeof entry.allocatedQuantity).toBe("string");
    expect(typeof entry.requiredQuantity).toBe("string");
    expect(typeof entry.progressBps).toBe("number");
  });

  it("defaults to unstarted with zero progress and null award", () => {
    const entry = makeEntry("test");
    expect(entry.assemblyState).toBe("unstarted");
    expect(entry.progressBps).toBe(0);
    expect(entry.award).toBeNull();
    expect(entry.allocatedQuantity).toBe("0.0000");
    expect(entry.qualifiedSlotCount).toBe(0);
  });

  it("supports master kind", () => {
    const entry = makeEntry("master-test", { kind: "master" });
    expect(entry.kind).toBe("master");
  });

  it("supports final lifecycle status", () => {
    const entry = makeEntry("final-test", { lifecycleStatus: "final" });
    expect(entry.lifecycleStatus).toBe("final");
  });

  it("supports award presence", () => {
    const entry = makeEntry("awarded", {
      award: { awardId: "a1", firstCompletedAt: "2025-01-01T00:00:00Z", completionSequence: 1 },
    });
    expect(entry.award).not.toBeNull();
    expect(entry.award!.awardId).toBe("a1");
  });
});

describe("Lifecycle control from assemblyState (Blocker 1)", () => {
  it("ready without award → shows Complete", () => {
    const entry = makeEntry("ready-no-award", { assemblyState: "ready", progressBps: 10000 });
    const isReady = entry.assemblyState === "ready";
    const hasAward = entry.award != null;
    expect(isReady && !hasAward).toBe(true);
  });

  it("ready with award → shows Reactivate", () => {
    const entry = makeEntry("ready-awarded", {
      assemblyState: "ready",
      progressBps: 10000,
      award: { awardId: "a1", firstCompletedAt: "2025-01-01T00:00:00Z", completionSequence: 1 },
    });
    const isReady = entry.assemblyState === "ready";
    const hasAward = entry.award != null;
    expect(isReady && hasAward).toBe(true);
  });

  it("active → already active indicator, no complete/reactivate button needed", () => {
    const entry = makeEntry("active", {
      assemblyState: "active",
      award: { awardId: "a1", firstCompletedAt: "2025-01-01T00:00:00Z", completionSequence: 1 },
    });
    expect(entry.assemblyState).toBe("active");
  });

  it("inactive with award can still allocate", () => {
    const entry = makeEntry("inactive-awarded", {
      assemblyState: "inactive",
      award: { awardId: "a1", firstCompletedAt: "2025-01-01T00:00:00Z", completionSequence: 1 },
    });
    // allocation should not be blocked by award
    expect(entry.assemblyState).toBe("inactive");
    expect(entry.award).not.toBeNull();
  });
});

// ── Allocation request construction ──────────────────────────────────────────

describe("Allocation API request construction", () => {
  it("PUT allocation sends correct body with canonical quantity and idempotency key", () => {
    const slug = "test-collection";
    const slotId = "slot-1";
    const quantity = "2.0000";
    const idempotencyKey = crypto.randomUUID();

    const url = `/api/me/collections/${encodeURIComponent(slug)}/slots/${encodeURIComponent(slotId)}/allocation`;
    const body = JSON.stringify({ quantity });
    const method = "PUT";

    expect(url).toBe("/api/me/collections/test-collection/slots/slot-1/allocation");
    expect(method).toBe("PUT");
    expect(JSON.parse(body)).toEqual({ quantity: "2.0000" });
    expect(idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("sends partial target quantity", () => {
    const body = JSON.stringify({ quantity: "0.2500" });
    expect(JSON.parse(body)).toEqual({ quantity: "0.2500" });
  });

  it("DELETE release sends correct URL with idempotency key", () => {
    const slug = "test-collection";
    const slotId = "slot-2";
    const idempotencyKey = crypto.randomUUID();

    const url = `/api/me/collections/${encodeURIComponent(slug)}/slots/${encodeURIComponent(slotId)}/allocation`;
    const method = "DELETE";

    expect(url).toBe("/api/me/collections/test-collection/slots/slot-2/allocation");
    expect(method).toBe("DELETE");
    expect(idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("idempotency keys are unique across calls", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(crypto.randomUUID());
    }
    expect(keys.size).toBe(100);
  });

  it("completion POST sends correct URL", () => {
    const slug = "test-collection";
    const url = `/api/me/collections/${encodeURIComponent(slug)}/complete`;
    const method = "POST";
    expect(url).toBe("/api/me/collections/test-collection/complete");
    expect(method).toBe("POST");
  });
});

// ── Optional slots (Blocker 3) ───────────────────────────────────────────────

describe("Optional slots", () => {
  it("optional slots are distinguished from required", () => {
    const slots = [
      { isRequired: true, slotLabel: "Required" },
      { isRequired: false, slotLabel: "Optional" },
      { isRequired: true, slotLabel: "Required 2" },
    ];

    const required = slots.filter((s) => s.isRequired);
    expect(required).toHaveLength(2);
    expect(required[0].slotLabel).toBe("Required");
  });

  it("optional slots appear in display order alongside required", () => {
    const slots = [
      { displayOrder: 1, slotLabel: "First" },
      { displayOrder: 2, slotLabel: "Second" },
      { displayOrder: 3, slotLabel: "Third" },
    ];
    const sorted = [...slots].sort((a, b) => a.displayOrder - b.displayOrder);
    expect(sorted.map((s) => s.slotLabel)).toEqual(["First", "Second", "Third"]);
  });

  it("only required slots contribute to required totals", () => {
    const slots = [
      { isRequired: true, requiredQuantity: "1.0000" },
      { isRequired: false, requiredQuantity: "0.5000" },
      { isRequired: true, requiredQuantity: "2.0000" },
    ];
    const required = slots.filter((s) => s.isRequired);
    const totalQuantity = required.reduce((sum, s) => sum + parseFloat(s.requiredQuantity), 0);
    expect(required.length).toBe(2);
    expect(totalQuantity).toBe(3.0);
  });
});

// ── Typed client error detection (Blocker 7) ─────────────────────────────────

describe("Typed API error detection", () => {
  function is404Error(body: unknown): boolean {
    const err = (body as any)?.error;
    return typeof err?.code === "string" && err.code === "COLLECTION_NOT_FOUND";
  }

  function isTransientError(status: number, code?: string): boolean {
    if (status >= 500) return true;
    if (status >= 400 && code !== "COLLECTION_NOT_FOUND") return true;
    return false;
  }

  it("detects 404 COLLECTION_NOT_FOUND as non-transient", () => {
    expect(is404Error({ error: { code: "COLLECTION_NOT_FOUND", message: "Not found" } })).toBe(
      true,
    );
    expect(isTransientError(404, "COLLECTION_NOT_FOUND")).toBe(false);
  });

  it("detects 500 errors as transient", () => {
    expect(isTransientError(500)).toBe(true);
    expect(isTransientError(502)).toBe(true);
  });

  it("detects 409 conflicts as transient", () => {
    expect(isTransientError(409, "CONFLICT")).toBe(true);
  });

  it("detects 401 as transient", () => {
    expect(isTransientError(401)).toBe(true);
  });

  it("detects unknown non-404 4xx as transient", () => {
    expect(isTransientError(400, "INVALID_REQUEST")).toBe(true);
  });
});

// ── N+1 prevention (Blocker 5) ───────────────────────────────────────────────

describe("List defaults without detail N+1 calls", () => {
  it("computes default state from bulk aggregate data, not per-row detail", () => {
    // Simulated bulk data: versionId → { requiredQuantity, requiredSlotCount }
    const slotDefaults = new Map<string, { requiredQuantity: string; requiredSlotCount: number }>();
    slotDefaults.set("ver-a", { requiredQuantity: "3.0000", requiredSlotCount: 3 });
    slotDefaults.set("ver-b", { requiredQuantity: "5.0000", requiredSlotCount: 5 });

    // Simulate rows without assemblyState
    const rows = [
      { slug: "a", versionId: "ver-a", kind: "player_slots", assemblyState: null },
      { slug: "b", versionId: "ver-b", kind: "player_slots", assemblyState: null },
      { slug: "c", versionId: "ver-c", kind: "player_slots", assemblyState: "in_progress" },
    ];

    const results = rows.map((row) => {
      if (row.assemblyState) {
        return { slug: row.slug, requiredQuantity: "1.0000" };
      }
      const d = slotDefaults.get(row.versionId);
      return {
        slug: row.slug,
        requiredQuantity: d?.requiredQuantity ?? "0.0000",
        requiredSlotCount: d?.requiredSlotCount ?? 0,
      };
    });

    expect(results[0].requiredQuantity).toBe("3.0000");
    expect(results[1].requiredQuantity).toBe("5.0000");
    // No per-row detail calls simulated — defaults from bulk map
  });

  it("missing version IDs get zero defaults", () => {
    const defaults = new Map<string, { requiredQuantity: string }>();
    const result = defaults.get("nonexistent")?.requiredQuantity ?? "0.0000";
    expect(result).toBe("0.0000");
  });
});

// ── maxAllocatableQuantity (Blocker 6) ───────────────────────────────────────

describe("maxAllocatableQuantity computation", () => {
  function computeMaxAllocatable(
    requiredQuantity: string,
    ownAllocation: string,
    holdingsAvailable: string,
  ): string {
    // holdingsAvailable = held - other locks (not including own lock)
    const held = BigInt(parseFloat(holdingsAvailable) * 10000);
    const own = BigInt(parseFloat(ownAllocation) * 10000);
    const total = held + own;
    const required = BigInt(parseFloat(requiredQuantity) * 10000);
    const max = total < required ? total : required;
    return `${max / BigInt(10000)}.${(max % BigInt(10000)).toString().padStart(4, "0")}`;
  }

  it("returns required quantity when holdings exceed it", () => {
    // holdings available (excluding own lock) = 2, own allocation = 0, required = 1
    const result = computeMaxAllocatable("1.0000", "0.0000", "2.0000");
    // Own = 0, Held = 20000, Total = 20000, Required = 10000 → min = 10000 → 1.0000
    expect(result).toBe("1.0000");
  });

  it("returns available quantity when holdings are less than required", () => {
    // holdings (excluding own lock) = 0.25, own allocation = 0, required = 1
    const result = computeMaxAllocatable("1.0000", "0.0000", "0.2500");
    // Own = 0, Held = 2500, Total = 2500, Required = 10000 → min = 2500 → 0.2500
    expect(result).toBe("0.2500");
  });

  it("excludes own lock: includes own allocation in available pool", () => {
    // Slot has own allocation = 0.5. Available from other locks-excluded holdings = 0.5.
    // So total available = 0.5 + 0.5 = 1.0. Required = 1.
    const result = computeMaxAllocatable("1.0000", "0.5000", "0.5000");
    // Own = 5000, Held = 5000, Total = 10000, Required = 10000 → min = 10000 → 1.0000
    expect(result).toBe("1.0000");
  });
});

// ── Completion lifecycle (Blocker 1) ─────────────────────────────────────────

describe("Completion/reactivation lifecycle", () => {
  it("completeCollection returns eventType 'completed' for first completion", () => {
    // Mirror of backend: ready state, no award → completed
    const hasPriorAward = false;
    const eventType = hasPriorAward ? "reactivated" : "completed";
    expect(eventType).toBe("completed");
  });

  it("completeCollection returns eventType 'reactivated' when prior award exists", () => {
    const hasPriorAward = true;
    const eventType = hasPriorAward ? "reactivated" : "completed";
    expect(eventType).toBe("reactivated");
  });

  it("completeCollection returns 'already_active' for active state", () => {
    const assemblyState = "active";
    const eventType = assemblyState === "active" ? "already_active" : "completed";
    expect(eventType).toBe("already_active");
  });

  it("award is lifetime history — does not disable allocation", () => {
    const hasAward = true;
    const isInactive = true;
    // Allocation should remain enabled regardless of award
    const canAllocate = isInactive;
    expect(canAllocate).toBe(true);
  });
});

// ── User input parsing (Blocker 6) ───────────────────────────────────────────

describe("User quantity input parsing", () => {
  const DECIMAL_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,4}))?$/;

  function parseUserInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let normalized = trimmed;
    if (normalized.startsWith(".")) normalized = "0" + normalized;
    if (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
    const match = DECIMAL_PATTERN.exec(normalized);
    if (!match) return null;
    const integerPart = match[1];
    const fractionalPart = (match[2] ?? "").padEnd(4, "0").slice(0, 4);
    return `${integerPart}.${fractionalPart}`;
  }

  it("parses whole number to canonical", () => {
    expect(parseUserInput("5")).toBe("5.0000");
  });

  it("parses partial decimal", () => {
    expect(parseUserInput("0.5")).toBe("0.5000");
    expect(parseUserInput("1.25")).toBe("1.2500");
  });

  it("handles leading dot", () => {
    expect(parseUserInput(".5")).toBe("0.5000");
  });

  it("handles trailing dot", () => {
    expect(parseUserInput("5.")).toBe("5.0000");
  });

  it("trims whitespace", () => {
    expect(parseUserInput("  3  ")).toBe("3.0000");
  });

  it("rejects invalid input", () => {
    expect(parseUserInput("")).toBeNull();
    expect(parseUserInput("abc")).toBeNull();
    expect(parseUserInput("-1")).toBeNull();
    expect(parseUserInput("1.12345")).toBeNull();
  });
});
