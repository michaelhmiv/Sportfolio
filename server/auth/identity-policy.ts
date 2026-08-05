import { createHash } from "node:crypto";

export type ExistingIdentityTombstone = {
  deletedAt?: Date | null;
  authProviderSubject?: string | null;
  authProviderSubjects?: string[] | null;
  authEmailIdentityHash?: string | null;
};

export function normalizeAuthEmail(email: string): string {
  const normalized = email.trim().normalize("NFKC").toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) {
    throw new Error("A syntactically valid email identity is required.");
  }
  return normalized;
}

export function hashAuthEmailIdentity(email: string): string {
  return createHash("sha256").update(normalizeAuthEmail(email), "utf8").digest("hex");
}

export function assertIdentityIsNotTombstoned(
  existing: ExistingIdentityTombstone | null | undefined,
  input: { providerSubject?: string | null; email?: string | null },
): void {
  if (!existing) return;
  const subject = input.providerSubject?.trim() || null;
  const emailHash = input.email ? hashAuthEmailIdentity(input.email) : null;
  const subjects = new Set(
    [existing.authProviderSubject, ...(existing.authProviderSubjects ?? [])].filter(
      (value): value is string => Boolean(value),
    ),
  );
  if (
    existing.deletedAt ||
    (subject && subjects.has(subject)) ||
    (emailHash && existing.authEmailIdentityHash === emailHash)
  ) {
    throw new Error("Identity is blocked by an existing deletion tombstone.");
  }
}
