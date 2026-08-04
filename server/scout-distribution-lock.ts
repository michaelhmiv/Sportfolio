import { createHash } from "node:crypto";

export type ScoutDistributionAdvisoryLockKeys = readonly [number, number];

/**
 * Derive the two signed 32-bit keys accepted by PostgreSQL's portable
 * pg_advisory_xact_lock(integer, integer) overload. Hashing in application
 * code avoids depending on optional database hash functions.
 */
export function deriveScoutDistributionAdvisoryLockKeys(
  eventKey: string,
): ScoutDistributionAdvisoryLockKeys {
  if (!eventKey.trim()) {
    throw new Error("Scout distribution advisory lock event key is required.");
  }
  const digest = createHash("sha256").update(eventKey, "utf8").digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)] as const;
}
