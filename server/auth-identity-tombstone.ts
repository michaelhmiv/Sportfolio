import { createHmac } from "node:crypto";

function getIdentityTombstoneSecrets(): string[] {
  const secrets = (
    process.env.ACCOUNT_DELETION_TOMBSTONE_SECRETS ||
    process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET ||
    ""
  )
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);

  if (secrets.length > 0) {
    return Array.from(new Set(secrets));
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ACCOUNT_DELETION_TOMBSTONE_SECRETS is required in production");
  }

  return ["sportfolio-development-identity-tombstone"];
}

export function hashAuthIdentityEmails(email: string | null | undefined): string[] {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return [];
  }

  return getIdentityTombstoneSecrets().map((secret) =>
    createHmac("sha256", secret).update(normalizedEmail, "utf8").digest("hex"),
  );
}

export function hashAuthIdentityEmail(email: string | null | undefined): string | null {
  return hashAuthIdentityEmails(email)[0] || null;
}
