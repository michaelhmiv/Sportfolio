import { createHash } from "node:crypto";

export type AdvisoryLockKeyPair = readonly [number, number];

/** Derive PostgreSQL's portable two-int advisory-lock identity in application code. */
export function advisoryLockKeyPair(identity: string): AdvisoryLockKeyPair {
  if (!identity.trim()) {
    throw new Error("Advisory lock identity is required.");
  }
  const digest = createHash("sha256").update(identity, "utf8").digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}
