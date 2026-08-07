import { createHash, randomUUID } from "node:crypto";
import {
  accountDeletionRequests,
  authIdentities,
  authUsers,
  userApiTokens,
  userBadgePreferences,
  userFeaturedCollections,
  userPushDevices,
  userPushTokens,
  users,
  type AccountDeletionRequest,
} from "@shared/schema";
import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../lib/logger";
import { hashAuthIdentityEmail } from "../auth-identity-tombstone";

const DEFAULT_DELETION_GRACE_HOURS = 24;
const MIN_DELETION_GRACE_HOURS = 1;
const MAX_DELETION_GRACE_HOURS = 168;
const DEFAULT_PROCESSOR_INTERVAL_MS = 60_000;
const MAX_PROCESS_BATCH_SIZE = 20;

const RETAINED_RECORDS_NOTE =
  "Trade, portfolio, and reward ledger records may be retained for fraud prevention, dispute handling, security auditing, and legal compliance.";

export const ACCOUNT_DELETION_CONFIRMATION_TEXT = "DELETE";

let accountDeletionProcessorTimer: NodeJS.Timeout | null = null;

function getDeletionGraceWindowMs(): number {
  const configuredHours = Number(process.env.ACCOUNT_DELETION_GRACE_HOURS);
  const safeHours = Number.isFinite(configuredHours)
    ? Math.max(MIN_DELETION_GRACE_HOURS, Math.min(MAX_DELETION_GRACE_HOURS, configuredHours))
    : DEFAULT_DELETION_GRACE_HOURS;
  return Math.round(safeHours * 60 * 60 * 1000);
}

function getProcessorIntervalMs(): number {
  const configuredMs = Number(process.env.ACCOUNT_DELETION_PROCESSOR_INTERVAL_MS);
  if (!Number.isFinite(configuredMs)) return DEFAULT_PROCESSOR_INTERVAL_MS;
  return Math.max(15_000, Math.min(10 * 60_000, Math.round(configuredMs)));
}

function toMetadataObject(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function buildDeletedUsername(userId: string): string {
  return `deleted_${userId.slice(0, 8)}_${randomUUID().slice(0, 8)}`.toLowerCase();
}

async function deleteBetterAuthUsersForCanonicalUser(
  userId: string,
): Promise<{ deleted: boolean; count: number; error: string | null }> {
  try {
    const identities = await db
      .select({ authUserId: authIdentities.authUserId })
      .from(authIdentities)
      .where(eq(authIdentities.sportfolioUserId, userId));
    const ids = [...new Set(identities.map((identity) => identity.authUserId))];
    for (const authUserId of ids) {
      await db.delete(authUsers).where(eq(authUsers.id, authUserId));
    }
    return { deleted: true, count: ids.length, error: null };
  } catch (error) {
    return {
      deleted: false,
      count: 0,
      error: error instanceof Error ? error.message : "better_auth_delete_failed",
    };
  }
}

export async function ensureAccountDeletionSchema(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS deleted_at timestamp,
        ADD COLUMN IF NOT EXISTS profile_visibility varchar(10) NOT NULL DEFAULT 'public',
        ADD COLUMN IF NOT EXISTS auth_provider_subject varchar,
        ADD COLUMN IF NOT EXISTS auth_provider_subjects text[] NOT NULL DEFAULT ARRAY[]::text[],
        ADD COLUMN IF NOT EXISTS auth_email_identity_hash varchar(64);
    `);
    await db.execute(sql`
      UPDATE users
      SET auth_provider_subjects = ARRAY(
        SELECT DISTINCT subject
        FROM unnest(array_remove(ARRAY[users.id, users.auth_provider_subject], NULL)) AS subject
      )
      WHERE cardinality(auth_provider_subjects) = 0;
    `);
    await db.execute(sql`
      UPDATE users
      SET auth_provider_subject = id
      WHERE auth_provider_subject IS NULL;
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_subject_unique
      ON users (auth_provider_subject);
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS users_auth_email_identity_hash_unique
      ON users (auth_email_identity_hash);
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS account_deletion_requests (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE cascade,
        status text NOT NULL DEFAULT 'pending',
        reason text,
        details text,
        requested_at timestamp NOT NULL DEFAULT now(),
        effective_at timestamp NOT NULL,
        cancelled_at timestamp,
        processed_at timestamp,
        retained_records_note text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS account_deletion_requests_user_status_idx
      ON account_deletion_requests (user_id, status);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS account_deletion_requests_effective_idx
      ON account_deletion_requests (status, effective_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS account_deletion_requests_requested_idx
      ON account_deletion_requests (requested_at);
    `);
  } catch (error: any) {
    logger.warn({ err: error }, "[ACCOUNT_DELETION] Could not ensure account deletion schema");
  }
}

export async function getLatestAccountDeletionRequest(
  userId: string,
): Promise<AccountDeletionRequest | undefined> {
  const [latest] = await db
    .select()
    .from(accountDeletionRequests)
    .where(eq(accountDeletionRequests.userId, userId))
    .orderBy(desc(accountDeletionRequests.requestedAt))
    .limit(1);

  return latest || undefined;
}

export async function createAccountDeletionRequest(input: {
  userId: string;
  reason?: string | null;
  details?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ request: AccountDeletionRequest; alreadyPending: boolean }> {
  const now = new Date();
  const effectiveAt = new Date(now.getTime() + getDeletionGraceWindowMs());

  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for("update");
    if (!user) {
      throw new Error("User not found");
    }

    if (user.deletedAt) {
      throw new Error("Account already deleted");
    }

    const [existingPending] = await tx
      .select()
      .from(accountDeletionRequests)
      .where(
        and(
          eq(accountDeletionRequests.userId, input.userId),
          eq(accountDeletionRequests.status, "pending"),
        ),
      )
      .orderBy(desc(accountDeletionRequests.requestedAt))
      .limit(1)
      .for("update");

    if (existingPending) {
      return { request: existingPending, alreadyPending: true };
    }

    const [created] = await tx
      .insert(accountDeletionRequests)
      .values({
        userId: input.userId,
        status: "pending",
        reason: input.reason?.trim() || null,
        details: input.details?.trim() || null,
        effectiveAt,
        retainedRecordsNote: RETAINED_RECORDS_NOTE,
        metadata: {
          ...(input.metadata || {}),
          requestedAtIso: now.toISOString(),
        },
      })
      .returning();

    return { request: created, alreadyPending: false };
  });
}

export async function cancelPendingAccountDeletionRequest(
  userId: string,
): Promise<AccountDeletionRequest | undefined> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(accountDeletionRequests)
      .where(
        and(
          eq(accountDeletionRequests.userId, userId),
          eq(accountDeletionRequests.status, "pending"),
        ),
      )
      .orderBy(desc(accountDeletionRequests.requestedAt))
      .limit(1)
      .for("update");

    if (!pending) {
      return undefined;
    }

    const nextMetadata = {
      ...toMetadataObject(pending.metadata),
      cancelledAtIso: now.toISOString(),
      cancelledByUser: true,
    };

    const [cancelled] = await tx
      .update(accountDeletionRequests)
      .set({
        status: "cancelled",
        cancelledAt: now,
        metadata: nextMetadata,
      })
      .where(eq(accountDeletionRequests.id, pending.id))
      .returning();

    return cancelled;
  });
}

async function processSingleAccountDeletionRequest(
  request: AccountDeletionRequest,
  now: Date,
): Promise<"completed" | "failed" | "skipped"> {
  const lockResult = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, request.id))
      .for("update");

    if (!locked || (locked.status !== "pending" && locked.status !== "provider_cleanup_pending")) {
      return { status: "skipped" as const };
    }

    const [user] = await tx.select().from(users).where(eq(users.id, locked.userId)).for("update");

    if (!user) {
      const [failed] = await tx
        .update(accountDeletionRequests)
        .set({
          status: "failed",
          processedAt: now,
          metadata: {
            ...toMetadataObject(locked.metadata),
            failureCode: "user_not_found",
            processedAtIso: now.toISOString(),
          },
        })
        .where(eq(accountDeletionRequests.id, locked.id))
        .returning();

      return { status: "failed" as const, request: failed, userId: locked.userId };
    }

    if (locked.status === "provider_cleanup_pending" && user.deletedAt) {
      return {
        status: "ready" as const,
        request: locked,
        userId: user.id,
        authProviderSubjects: Array.from(
          new Set(
            [...(user.authProviderSubjects || []), user.authProviderSubject, user.id].filter(
              Boolean,
            ),
          ),
        ) as string[],
        deletedUsername: user.username || buildDeletedUsername(user.id),
      };
    }

    const deletedUsername = buildDeletedUsername(user.id);

    await tx
      .update(users)
      .set({
        email: null,
        authEmailIdentityHash: hashAuthIdentityEmail(user.email),
        firstName: null,
        lastName: null,
        profileImageUrl: null,
        username: deletedUsername,
        isPremium: false,
        premiumExpiresAt: null,
        newsNotificationsEnabled: false,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    // Trophy Case selections are presentation preferences, not retained ledger
    // records. Account deletion soft-deletes the user row, so FK cascades do not
    // fire; erase these rows explicitly inside the same transaction.
    await tx.delete(userBadgePreferences).where(eq(userBadgePreferences.userId, user.id));
    await tx.delete(userFeaturedCollections).where(eq(userFeaturedCollections.userId, user.id));
    await tx.delete(userPushDevices).where(eq(userPushDevices.userId, user.id));

    await tx
      .update(userApiTokens)
      .set({ revokedAt: now })
      .where(and(eq(userApiTokens.userId, user.id), sql`${userApiTokens.revokedAt} IS NULL`));

    await tx.delete(userPushTokens).where(eq(userPushTokens.userId, user.id));

    const [processingMarked] = await tx
      .update(accountDeletionRequests)
      .set({
        status: "provider_cleanup_pending",
        metadata: {
          ...toMetadataObject(locked.metadata),
          processingStartedAtIso: now.toISOString(),
          processingUserHash: hashIdentifier(user.id),
          localErasureCompletedAtIso: now.toISOString(),
        },
      })
      .where(eq(accountDeletionRequests.id, locked.id))
      .returning();

    return {
      status: "ready" as const,
      request: processingMarked,
      userId: user.id,
      authProviderSubjects: Array.from(
        new Set(
          [...(user.authProviderSubjects || []), user.authProviderSubject, user.id].filter(Boolean),
        ),
      ) as string[],
      deletedUsername,
    };
  });

  if (lockResult.status === "skipped") {
    return "skipped";
  }

  if (lockResult.status === "failed") {
    logger.warn(
      {
        requestId: lockResult.request?.id,
        userIdHash: hashIdentifier(lockResult.userId),
      },
      "[ACCOUNT_DELETION] Marked deletion request as failed because user was missing",
    );
    return "failed";
  }

  const authDeletionResult = await deleteBetterAuthUsersForCanonicalUser(lockResult.userId);
  const authDeletion = {
    deleted: authDeletionResult.deleted,
    error: authDeletionResult.error || undefined,
    count: authDeletionResult.count,
  };
  const completionTime = new Date();

  const [completed] = await db
    .update(accountDeletionRequests)
    .set({
      status: authDeletion.deleted ? "completed" : "provider_cleanup_pending",
      processedAt: authDeletion.deleted ? completionTime : null,
      retainedRecordsNote: RETAINED_RECORDS_NOTE,
      metadata: {
        ...toMetadataObject(lockResult.request.metadata),
        ...(authDeletion.deleted ? { processedAtIso: completionTime.toISOString() } : {}),
        authDeletionAttemptedAtIso: completionTime.toISOString(),
        authDeletionSubjectCount: authDeletion.count,
        authDeletionStatus: authDeletion.deleted ? "deleted" : "retry_pending",
        authDeletionError: authDeletion.error,
      },
    })
    .where(eq(accountDeletionRequests.id, lockResult.request.id))
    .returning();

  logger.info(
    {
      requestId: completed?.id || lockResult.request.id,
      userIdHash: hashIdentifier(lockResult.userId),
      authDeletionStatus: authDeletion.deleted ? "deleted" : "not_deleted",
      deletedUsername: lockResult.deletedUsername,
    },
    "[ACCOUNT_DELETION] Processed Better Auth account deletion request",
  );

  return authDeletion.deleted ? "completed" : "failed";
}

export async function processDueAccountDeletionRequests(
  now: Date = new Date(),
  limit: number = MAX_PROCESS_BATCH_SIZE,
): Promise<{ scanned: number; completed: number; failed: number }> {
  const dueRequests = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        or(
          eq(accountDeletionRequests.status, "pending"),
          eq(accountDeletionRequests.status, "provider_cleanup_pending"),
        ),
        lte(accountDeletionRequests.effectiveAt, now),
      ),
    )
    .orderBy(asc(accountDeletionRequests.effectiveAt))
    .limit(Math.max(1, Math.min(MAX_PROCESS_BATCH_SIZE, limit)));

  let completed = 0;
  let failed = 0;

  for (const request of dueRequests) {
    try {
      const outcome = await processSingleAccountDeletionRequest(request, now);
      if (outcome === "completed") completed += 1;
      if (outcome === "failed") failed += 1;
    } catch (error: any) {
      failed += 1;
      logger.error(
        {
          err: error,
          requestId: request.id,
          userIdHash: hashIdentifier(request.userId),
        },
        "[ACCOUNT_DELETION] Unexpected processor error",
      );
    }
  }

  return {
    scanned: dueRequests.length,
    completed,
    failed,
  };
}

export function startAccountDeletionProcessor() {
  if (accountDeletionProcessorTimer) {
    return;
  }

  const intervalMs = getProcessorIntervalMs();
  accountDeletionProcessorTimer = setInterval(() => {
    void processDueAccountDeletionRequests().catch((error: any) => {
      logger.error({ err: error }, "[ACCOUNT_DELETION] Processor tick failed");
    });
  }, intervalMs);

  accountDeletionProcessorTimer.unref?.();

  void processDueAccountDeletionRequests().catch((error: any) => {
    logger.error({ err: error }, "[ACCOUNT_DELETION] Initial processor run failed");
  });

  logger.info(
    {
      intervalMs,
      graceHours: Math.round(getDeletionGraceWindowMs() / (60 * 60 * 1000)),
    },
    "[ACCOUNT_DELETION] Background processor started",
  );
}

export function stopAccountDeletionProcessor() {
  if (!accountDeletionProcessorTimer) {
    return;
  }

  clearInterval(accountDeletionProcessorTimer);
  accountDeletionProcessorTimer = null;
}
