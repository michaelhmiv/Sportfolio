import { describe, expect, it, vi } from "vitest";
import type { PublicUserIdentity, PublicBadgeIdentity } from "@shared/public-user-identity";

// We'll import these after creating the service
// For now, define the interface inline for RED phase
interface PublicIdentityRepository {
  resolveIdentities(userIds: string[]): Promise<(PublicUserIdentity | null)[]>;
}

interface PublicIdentityService {
  resolveBatch(rawBody: unknown): Promise<PublicUserIdentity[]>;
}

describe("Public identity service", () => {
  // ── validation ───────────────────────────────────────────────────────────

  it("rejects non-array userIds", () => {
    const errors = validateBatchRequest("not-an-array");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("INVALID_REQUEST");
  });

  it("rejects null/undefined body", () => {
    expect(validateBatchRequest(null).length).toBeGreaterThan(0);
    expect(validateBatchRequest(undefined).length).toBeGreaterThan(0);
  });

  it("rejects empty array", () => {
    const errors = validateBatchRequest({ userIds: [] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("INVALID_REQUEST");
  });

  it("rejects more than 100 raw entries", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `user-${i}`);
    const errors = validateBatchRequest({ userIds: ids });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("INVALID_REQUEST");
  });

  it("rejects more than 100 unique IDs after dedupe", () => {
    // 50 unique but each duplicated twice = 100 raw entries with 50 unique.
    // This should pass uniqueness check. We test 51 unique × 2 = 102 raw.
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) {
      ids.push(`user-${i}`);
      ids.push(`user-${i}`);
    }
    // 102 raw entries → rejected for raw count
    const errors = validateBatchRequest({ userIds: ids });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("INVALID_REQUEST");
  });

  it("rejects blank IDs", () => {
    const errors = validateBatchRequest({ userIds: ["ok-id", "  ", ""] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("INVALID_REQUEST");
  });

  it("rejects non-string IDs", () => {
    const errors = validateBatchRequest({ userIds: ["ok-id", 123 as any] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects oversized IDs", () => {
    const longId = "a".repeat(201); // 200 max
    const errors = validateBatchRequest({ userIds: [longId] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects extra fields in body", () => {
    const errors = validateBatchRequest({ userIds: ["ok"], extra: "nope" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("INVALID_REQUEST");
  });

  it("accepts valid request with 1-100 unique IDs", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `user-${i}`);
    const errors = validateBatchRequest({ userIds: ids });
    expect(errors.length).toBe(0);
  });

  it("trims IDs before validation", () => {
    const errors = validateBatchRequest({ userIds: ["  user-1  ", "user-2"] });
    expect(errors.length).toBe(0);
  });

  it("rejects IDs that are blank after trim", () => {
    const errors = validateBatchRequest({ userIds: ["   ", "  "] });
    expect(errors.length).toBeGreaterThan(0);
  });

  // ── deduplication ────────────────────────────────────────────────────────

  it("deduplicates deterministically (first-occurrence order)", () => {
    const deduped = deduplicateIds(["b", "a", "b", "c", "a"]);
    expect(deduped).toEqual(["b", "a", "c"]);
  });

  // ── mapping ──────────────────────────────────────────────────────────────

  it("returns null for missing users", () => {
    const repo: PublicIdentityRepository = {
      resolveIdentities: vi.fn().mockResolvedValue([null, null]),
    };
    // ... to be completed in GREEN phase
  });

  it("returns identities in deduplicated request order", () => {
    // ... to be completed in GREEN phase
  });
});

// ── inline helpers for RED-phase testing ────────────────────────────────────

interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const MAX_RAW_IDS = 100;
const MAX_RAW_REQUEST_IDS = 100;
const MAX_ID_LENGTH = 200;

function validateBatchRequest(body: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    errors.push({
      code: "INVALID_REQUEST",
      message: "Request body must be a JSON object",
    });
    return errors;
  }

  const obj = body as Record<string, unknown>;
  const allowedKeys = new Set(["userIds"]);
  const extraKeys = Object.keys(obj).filter((k) => !allowedKeys.has(k));
  if (extraKeys.length > 0) {
    errors.push({
      code: "INVALID_REQUEST",
      message: `Unexpected fields: ${extraKeys.join(", ")}`,
    });
    return errors;
  }

  const userIds = obj.userIds;

  if (!Array.isArray(userIds)) {
    errors.push({
      code: "INVALID_REQUEST",
      message: "userIds must be an array of strings",
    });
    return errors;
  }

  if (userIds.length === 0) {
    errors.push({
      code: "INVALID_REQUEST",
      message: "userIds must not be empty",
    });
    return errors;
  }

  if (userIds.length > MAX_RAW_REQUEST_IDS) {
    errors.push({
      code: "INVALID_REQUEST",
      message: `Maximum ${MAX_RAW_REQUEST_IDS} user IDs allowed`,
      details: { max: MAX_RAW_REQUEST_IDS, received: userIds.length },
    });
    return errors;
  }

  const trimmed: string[] = [];

  for (let i = 0; i < userIds.length; i++) {
    const id = userIds[i];
    if (typeof id !== "string") {
      errors.push({
        code: "INVALID_REQUEST",
        message: `userIds[${i}] must be a string`,
      });
      continue;
    }
    const t = id.trim();
    if (t.length === 0) {
      errors.push({
        code: "INVALID_REQUEST",
        message: `userIds[${i}] must not be blank`,
      });
      continue;
    }
    if (t.length > MAX_ID_LENGTH) {
      errors.push({
        code: "INVALID_REQUEST",
        message: `userIds[${i}] exceeds maximum length of ${MAX_ID_LENGTH}`,
      });
      continue;
    }
    trimmed.push(t);
  }

  if (errors.length > 0) return errors;

  // Check deduplicated count
  const unique = new Set(trimmed);
  if (unique.size > MAX_RAW_IDS) {
    errors.push({
      code: "INVALID_REQUEST",
      message: `Maximum ${MAX_RAW_IDS} unique user IDs allowed`,
      details: { max: MAX_RAW_IDS, received: unique.size },
    });
  }

  return errors;
}

function deduplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
