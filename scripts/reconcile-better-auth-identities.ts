import { eq, sql } from "drizzle-orm";
import { authIdentities, authUsers, users } from "@shared/schema";
import { db, pool } from "../server/db";
import { hashAuthEmailIdentity, normalizeAuthEmail } from "../server/auth/identity-policy";

const apply = process.argv.includes("--apply");

if (process.env.AUTH_DATABASE_ENVIRONMENT !== "production") {
  throw new Error("AUTH_DATABASE_ENVIRONMENT=production is required for shared identity reconciliation.");
}
if (process.env.AUTH_SHARED_PRODUCTION_DATABASE !== "true") {
  throw new Error("AUTH_SHARED_PRODUCTION_DATABASE=true is required for shared identity reconciliation.");
}
if (apply && process.env.AUTH_MIGRATION_MODE !== "apply") {
  throw new Error("AUTH_MIGRATION_MODE=apply is required with --apply.");
}

const authRows = await db
  .select({ id: authUsers.id, email: authUsers.email, emailVerified: authUsers.emailVerified })
  .from(authUsers);
const canonicalRows = await db
  .select({ id: users.id, email: users.email, deletedAt: users.deletedAt, authEmailIdentityHash: users.authEmailIdentityHash })
  .from(users);
const existingLinks = await db
  .select({ authUserId: authIdentities.authUserId, sportfolioUserId: authIdentities.sportfolioUserId })
  .from(authIdentities);

const linked = new Map(existingLinks.map((row) => [row.authUserId, row.sportfolioUserId]));
const canonicalByEmail = new Map<string, typeof canonicalRows>();
for (const row of canonicalRows) {
  if (!row.email) continue;
  const email = normalizeAuthEmail(row.email);
  canonicalByEmail.set(email, [...(canonicalByEmail.get(email) ?? []), row]);
}

let alreadyLinked = 0;
let matched = 0;
let inserted = 0;
let orphanAuthUsers = 0;
let conflicts = 0;
let unverified = 0;

for (const authUser of authRows) {
  if (linked.has(authUser.id)) {
    alreadyLinked += 1;
    continue;
  }
  if (!authUser.emailVerified) {
    unverified += 1;
    continue;
  }
  const email = normalizeAuthEmail(authUser.email);
  const candidates = canonicalByEmail.get(email) ?? [];
  if (candidates.length === 0) {
    orphanAuthUsers += 1;
    continue;
  }
  if (candidates.length !== 1 || candidates[0].deletedAt) {
    conflicts += 1;
    console.error(JSON.stringify({ type: "identity_conflict", authUserId: authUser.id, candidateCount: candidates.length }));
    continue;
  }

  matched += 1;
  if (apply) {
    const canonical = candidates[0];
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}))`);
      await tx
        .insert(authIdentities)
        .values({
          authUserId: authUser.id,
          sportfolioUserId: canonical.id,
          provider: "better-auth",
          providerSubject: authUser.id,
          normalizedEmail: email,
          originalEmail: authUser.email,
          verifiedAt: new Date(),
          metadata: { source: "finalization-reconciliation" },
        })
        .onConflictDoNothing();
      await tx
        .update(users)
        .set({ authEmailIdentityHash: hashAuthEmailIdentity(email) })
        .where(eq(users.id, canonical.id));
    });
    inserted += 1;
  }
}

const summary = {
  mode: apply ? "apply" : "audit",
  authUsers: authRows.length,
  canonicalUsers: canonicalRows.length,
  alreadyLinked,
  verifiedUnlinkedMatches: matched,
  inserted,
  orphanAuthUsers,
  unverifiedAuthUsers: unverified,
  conflicts,
};
console.log(JSON.stringify(summary));
await pool.end();

if (conflicts > 0) process.exitCode = 2;
