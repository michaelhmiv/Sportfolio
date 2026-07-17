import { afterEach, describe, expect, it } from "vitest";
import { hashAuthIdentityEmail, hashAuthIdentityEmails } from "./auth-identity-tombstone";

const originalSecrets = process.env.ACCOUNT_DELETION_TOMBSTONE_SECRETS;
const originalSecret = process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET;

afterEach(() => {
  if (originalSecrets === undefined) delete process.env.ACCOUNT_DELETION_TOMBSTONE_SECRETS;
  else process.env.ACCOUNT_DELETION_TOMBSTONE_SECRETS = originalSecrets;
  if (originalSecret === undefined) delete process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET;
  else process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET = originalSecret;
});

describe("auth identity tombstone key rotation", () => {
  it("writes with the primary key and still resolves hashes made with retained keys", () => {
    process.env.ACCOUNT_DELETION_TOMBSTONE_SECRETS = "new-key,old-key";
    delete process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET;
    const candidates = hashAuthIdentityEmails(" Owner@Example.com ");

    process.env.ACCOUNT_DELETION_TOMBSTONE_SECRETS = "old-key";
    const oldHash = hashAuthIdentityEmail("owner@example.com");

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).not.toBe(oldHash);
    expect(candidates).toContain(oldHash);
  });
});
