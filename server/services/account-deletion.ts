import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  accountDeletionRequests,
  userApiTokens,
  userPhoneLinks,
  userPushTokens,
  users,
  type AccountDeletionRequest,
} from "@shared/schema";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../lib/logger";

const DEFAULT_DELETION_GRACE_HOURS = 24;
const MIN_DELETION_GRACE_HOURS = 1;
const MAX_DELETION_GRACE_HOURS = 168;
const DEFAULT_PROCESSOR_INTERVAL_MS = 60_000;
const MAX_PROCESS_BATCH_SIZE = 20;

const RETAINED_RECORDS_NOTE =
  "Trade, portfolio, and reward ledger records may be retained for fraud prevention, dispute handling, security auditing, and legal compliance.";

export const ACCOUNT_DELETION_CONFIRMATION_TEXT = "DELETE";

let accountDeletionProcessorTimer: NodeJS.Timeout | null = null;

const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_KEY?.trim() || "";

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

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

async function deleteSupabaseAuthUser(userId: string): Promise<{ deleted: boolean; error: string | null }> {
  if (!supabaseAdmin) {
    return { deleted: false, error: "supabase_admin_unconfigured" };
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    return { deleted: false, error: error.message || "supabase_delete_failed" };
  }

  return { deleted: true, error: null };
}

export async function ensureAccountDeletionSchema(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamp;`);
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
    logger.warn(
      { err: error },
      "[ACCOUNT_DELETION] Could not ensure account deletion schema",
    );
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

    if (!locked || locked.status !== "pending") {
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

    const deletedUsername = buildDeletedUsername(user.id);

    await tx
      .update(users)
      .set({
        email: null,
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

    await tx
      .update(userApiTokens)
      .set({ revokedAt: now })
      .where(and(eq(userApiTokens.userId, user.id), sql`${userApiTokens.revokedAt} IS NULL`));

    await tx
      .update(userPushTokens)
      .set({
        isActive: false,
        invalidatedAt: now,
        lastError: "account_deleted",
        updatedAt: now,
      })
      .where(eq(userPushTokens.userId, user.id));

    await tx
      .update(userPhoneLinks)
      .set({
        smsEnabled: false,
        smsOptInStatus: "opted_out",
        smsOptedOutAt: now,
        updatedAt: now,
      })
      .where(eq(userPhoneLinks.userId, user.id));

    const [processingMarked] = await tx
      .update(accountDeletionRequests)
      .set({
        status: "processing",
        metadata: {
          ...toMetadataObject(locked.metadata),
          processingStartedAtIso: now.toISOString(),
          processingUserHash: hashIdentifier(user.id),
        },
      })
      .where(eq(accountDeletionRequests.id, locked.id))
      .returning();

    return {
      status: "ready" as const,
      request: processingMarked,
      userId: user.id,
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

  const authDeletion = await deleteSupabaseAuthUser(lockResult.userId);
  const completionTime = new Date();

  const [completed] = await db
    .update(accountDeletionRequests)
    .set({
      status: "completed",
      processedAt: completionTime,
      retainedRecordsNote: RETAINED_RECORDS_NOTE,
      metadata: {
        ...toMetadataObject(lockResult.request.metadata),
        processedAtIso: completionTime.toISOString(),
        authDeletionAttemptedAtIso: completionTime.toISOString(),
        authDeletionStatus: authDeletion.deleted ? "deleted" : "not_deleted",
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
    "[ACCOUNT_DELETION] Processed account deletion request",
  );

  return "completed";
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
        eq(accountDeletionRequests.status, "pending"),
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
