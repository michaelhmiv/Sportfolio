import type { PublicUserIdentity, PublicIdentityBatchRequest } from "@shared/public-user-identity";
import type { PublicIdentityRepository } from "./public-identity-repository";

// ── validation ──────────────────────────────────────────────────────────────

const MAX_RAW_REQUEST_IDS = 100;
const MAX_UNIQUE_IDS = 100;
const MAX_ID_LENGTH = 200;

export interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function validateBatchRequest(body: unknown): ValidationError[] {
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
  if (unique.size > MAX_UNIQUE_IDS) {
    errors.push({
      code: "INVALID_REQUEST",
      message: `Maximum ${MAX_UNIQUE_IDS} unique user IDs allowed`,
      details: { max: MAX_UNIQUE_IDS, received: unique.size },
    });
  }

  return errors;
}

// ── deduplication ───────────────────────────────────────────────────────────

export function deduplicateIds(ids: string[]): string[] {
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

// ── service ─────────────────────────────────────────────────────────────────

export interface PublicIdentityService {
  resolveBatch(request: PublicIdentityBatchRequest): Promise<(PublicUserIdentity | null)[]>;
}

export class PostgresPublicIdentityService implements PublicIdentityService {
  constructor(private readonly repository: PublicIdentityRepository) {}

  async resolveBatch(request: PublicIdentityBatchRequest): Promise<(PublicUserIdentity | null)[]> {
    const trimmed = request.userIds.map((id) => id.trim());
    return this.repository.resolveIdentities(trimmed);
  }
}
