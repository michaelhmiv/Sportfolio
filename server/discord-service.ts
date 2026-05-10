import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { createHmac, randomBytes } from "crypto";
import {
  discordLinkStates,
  discordPostHistory,
  discordReportSyncs,
  discordTradeIntents,
  discordUserLinks,
} from "@shared/schema";
import { db } from "./db";
import type {
  DiscordLinkState,
  DiscordPostHistory,
  DiscordReportSync,
  DiscordTradeIntent,
  DiscordUserLink,
} from "@shared/schema";

const LINK_STATE_TTL_MS = 30 * 60 * 1000;

function buildStateHash(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function createDiscordStateToken(): string {
  return randomBytes(24).toString("hex");
}

export async function ensureDiscordSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "discord_user_links" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "discord_user_id" varchar(32) NOT NULL,
      "discord_username" text,
      "discord_global_name" text,
      "guild_id" varchar(32),
      "linked_at" timestamp NOT NULL DEFAULT now(),
      "last_seen_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "discord_user_links_user_idx"
      ON "discord_user_links" ("user_id");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "discord_user_links_discord_user_idx"
      ON "discord_user_links" ("discord_user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_user_links_guild_idx"
      ON "discord_user_links" ("guild_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "discord_link_states" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "state_hash" text NOT NULL,
      "discord_user_id" varchar(32) NOT NULL,
      "discord_username" text,
      "discord_global_name" text,
      "guild_id" varchar(32),
      "channel_id" varchar(32),
      "expires_at" timestamp NOT NULL,
      "consumed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "discord_link_states_hash_idx"
      ON "discord_link_states" ("state_hash");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_link_states_discord_user_idx"
      ON "discord_link_states" ("discord_user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_link_states_expiry_idx"
      ON "discord_link_states" ("expires_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "discord_trade_intents" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "discord_user_id" varchar(32) NOT NULL,
      "guild_id" varchar(32),
      "command_type" text NOT NULL,
      "player_id" varchar NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
      "amount" numeric(20, 6) NOT NULL,
      "max_slippage" numeric(12, 6),
      "expires_at" timestamp NOT NULL,
      "consumed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_trade_intents_user_idx"
      ON "discord_trade_intents" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_trade_intents_discord_user_idx"
      ON "discord_trade_intents" ("discord_user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_trade_intents_expiry_idx"
      ON "discord_trade_intents" ("expires_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "discord_post_history" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "channel_id" varchar(32) NOT NULL,
      "source_type" text NOT NULL,
      "source_key" text NOT NULL,
      "discord_message_id" varchar(32),
      "posted_at" timestamp NOT NULL DEFAULT now(),
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "discord_post_history_dedupe_idx"
      ON "discord_post_history" ("channel_id", "source_type", "source_key");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_post_history_source_idx"
      ON "discord_post_history" ("source_type", "created_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "discord_report_syncs" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "thread_channel_id" varchar(32) NOT NULL,
      "parent_channel_id" varchar(32) NOT NULL,
      "report_type" text NOT NULL,
      "thread_name" text,
      "github_owner" text NOT NULL,
      "github_repo" text NOT NULL,
      "github_issue_number" integer NOT NULL,
      "github_issue_url" text NOT NULL,
      "created_by_discord_user_id" varchar(32),
      "last_synced_message_id" varchar(32),
      "last_synced_at" timestamp NOT NULL DEFAULT now(),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "discord_report_syncs_thread_idx"
      ON "discord_report_syncs" ("thread_channel_id");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "discord_report_syncs_issue_idx"
      ON "discord_report_syncs" ("github_owner", "github_repo", "github_issue_number");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "discord_report_syncs_type_idx"
      ON "discord_report_syncs" ("report_type", "created_at");
  `);
}

export async function createDiscordLinkState(input: {
  secret: string;
  discordUserId: string;
  discordUsername?: string | null;
  discordGlobalName?: string | null;
  guildId?: string | null;
  channelId?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = createDiscordStateToken();
  const stateHash = buildStateHash(input.secret, token);
  const expiresAt = new Date(Date.now() + LINK_STATE_TTL_MS);

  await db
    .update(discordLinkStates)
    .set({
      consumedAt: new Date(),
    })
    .where(
      and(
        eq(discordLinkStates.discordUserId, input.discordUserId),
        isNull(discordLinkStates.consumedAt),
      ),
    );

  await db.insert(discordLinkStates).values({
    stateHash,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername ?? null,
    discordGlobalName: input.discordGlobalName ?? null,
    guildId: input.guildId ?? null,
    channelId: input.channelId ?? null,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function getDiscordLinkByDiscordUserId(
  discordUserId: string,
): Promise<DiscordUserLink | null> {
  const [row] = await db
    .select()
    .from(discordUserLinks)
    .where(eq(discordUserLinks.discordUserId, discordUserId))
    .limit(1);
  return row || null;
}

export async function getDiscordLinkByUserId(userId: string): Promise<DiscordUserLink | null> {
  const [row] = await db
    .select()
    .from(discordUserLinks)
    .where(eq(discordUserLinks.userId, userId))
    .limit(1);
  return row || null;
}

export async function validateDiscordLinkState(input: {
  secret: string;
  token: string;
}): Promise<DiscordLinkState | null> {
  const normalizedToken = input.token.trim();
  if (!/^[a-f0-9]{48}$/i.test(normalizedToken)) {
    return null;
  }

  const stateHash = buildStateHash(input.secret, normalizedToken);
  const [row] = await db
    .select()
    .from(discordLinkStates)
    .where(
      and(
        eq(discordLinkStates.stateHash, stateHash),
        isNull(discordLinkStates.consumedAt),
        gt(discordLinkStates.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row || null;
}

export async function consumeDiscordLinkStateForUser(input: {
  secret: string;
  token: string;
  userId: string;
}): Promise<DiscordUserLink> {
  const normalizedToken = input.token.trim();
  if (!/^[a-f0-9]{48}$/i.test(normalizedToken)) {
    throw new Error("That Discord link is invalid");
  }

  const stateHash = buildStateHash(input.secret, normalizedToken);

  return db.transaction(async (tx) => {
    const [stateRow] = await tx
      .select()
      .from(discordLinkStates)
      .where(
        and(
          eq(discordLinkStates.stateHash, stateHash),
          isNull(discordLinkStates.consumedAt),
          gt(discordLinkStates.expiresAt, new Date()),
        ),
      )
      .for("update")
      .limit(1);

    if (!stateRow) {
      throw new Error("That Discord link is expired or invalid");
    }

    const [existingByDiscordId] = await tx
      .select()
      .from(discordUserLinks)
      .where(eq(discordUserLinks.discordUserId, stateRow.discordUserId))
      .for("update")
      .limit(1);

    if (existingByDiscordId && existingByDiscordId.userId !== input.userId) {
      throw new Error("That Discord account is already linked to another Sportfolio user");
    }

    const now = new Date();

    const [linked] = await tx
      .insert(discordUserLinks)
      .values({
        userId: input.userId,
        discordUserId: stateRow.discordUserId,
        discordUsername: stateRow.discordUsername,
        discordGlobalName: stateRow.discordGlobalName,
        guildId: stateRow.guildId,
        linkedAt: now,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: discordUserLinks.userId,
        set: {
          discordUserId: stateRow.discordUserId,
          discordUsername: stateRow.discordUsername,
          discordGlobalName: stateRow.discordGlobalName,
          guildId: stateRow.guildId,
          linkedAt: now,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning();

    await tx
      .update(discordLinkStates)
      .set({ consumedAt: now })
      .where(eq(discordLinkStates.id, stateRow.id));

    return linked;
  });
}

export async function touchDiscordLink(discordUserId: string): Promise<void> {
  await db
    .update(discordUserLinks)
    .set({
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(discordUserLinks.discordUserId, discordUserId));
}

export async function createDiscordTradeIntent(input: {
  userId: string;
  discordUserId: string;
  guildId?: string | null;
  commandType: "buy" | "sell";
  playerId: string;
  amount: number;
  maxSlippage?: number | null;
  ttlMs: number;
}): Promise<DiscordTradeIntent> {
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await db
    .insert(discordTradeIntents)
    .values({
      userId: input.userId,
      discordUserId: input.discordUserId,
      guildId: input.guildId ?? null,
      commandType: input.commandType,
      playerId: input.playerId,
      amount: input.amount.toFixed(6),
      maxSlippage:
        input.maxSlippage === null || input.maxSlippage === undefined
          ? null
          : input.maxSlippage.toFixed(6),
      expiresAt,
    })
    .returning();

  return row;
}

export async function consumeDiscordTradeIntent(input: {
  intentId: string;
  discordUserId: string;
}): Promise<DiscordTradeIntent | null> {
  return db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(discordTradeIntents)
      .where(eq(discordTradeIntents.id, input.intentId))
      .for("update")
      .limit(1);

    if (!intent) {
      return null;
    }

    if (intent.discordUserId !== input.discordUserId) {
      return null;
    }

    if (intent.consumedAt || intent.expiresAt <= new Date()) {
      return null;
    }

    await tx
      .update(discordTradeIntents)
      .set({ consumedAt: new Date() })
      .where(eq(discordTradeIntents.id, intent.id));

    return intent;
  });
}

export async function getDiscordTradeIntent(input: {
  intentId: string;
  discordUserId: string;
}): Promise<DiscordTradeIntent | null> {
  const [intent] = await db
    .select()
    .from(discordTradeIntents)
    .where(
      and(
        eq(discordTradeIntents.id, input.intentId),
        eq(discordTradeIntents.discordUserId, input.discordUserId),
      ),
    )
    .limit(1);

  return intent || null;
}

export async function cancelDiscordTradeIntent(input: {
  intentId: string;
  discordUserId: string;
}): Promise<boolean> {
  const result = await db
    .update(discordTradeIntents)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(discordTradeIntents.id, input.intentId),
        eq(discordTradeIntents.discordUserId, input.discordUserId),
        isNull(discordTradeIntents.consumedAt),
      ),
    );

  return (result.rowCount || 0) > 0;
}

export async function recordDiscordPost(input: {
  channelId: string;
  sourceType: "news" | "hourly_digest";
  sourceKey: string;
  discordMessageId?: string | null;
}): Promise<DiscordPostHistory | null> {
  const [row] = await db
    .insert(discordPostHistory)
    .values({
      channelId: input.channelId,
      sourceType: input.sourceType,
      sourceKey: input.sourceKey,
      discordMessageId: input.discordMessageId ?? null,
    })
    .onConflictDoNothing({
      target: [
        discordPostHistory.channelId,
        discordPostHistory.sourceType,
        discordPostHistory.sourceKey,
      ],
    })
    .returning();

  return row || null;
}

export async function hasDiscordPost(input: {
  channelId: string;
  sourceType: "news" | "hourly_digest";
  sourceKey: string;
}): Promise<boolean> {
  const [row] = await db
    .select({ id: discordPostHistory.id })
    .from(discordPostHistory)
    .where(
      and(
        eq(discordPostHistory.channelId, input.channelId),
        eq(discordPostHistory.sourceType, input.sourceType),
        eq(discordPostHistory.sourceKey, input.sourceKey),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function getDiscordReportSyncByThreadChannelId(
  threadChannelId: string,
): Promise<DiscordReportSync | null> {
  const [row] = await db
    .select()
    .from(discordReportSyncs)
    .where(eq(discordReportSyncs.threadChannelId, threadChannelId))
    .limit(1);

  return row || null;
}

export async function upsertDiscordReportSync(input: {
  threadChannelId: string;
  parentChannelId: string;
  reportType: "bug" | "feature";
  threadName?: string | null;
  githubOwner: string;
  githubRepo: string;
  githubIssueNumber: number;
  githubIssueUrl: string;
  createdByDiscordUserId?: string | null;
  lastSyncedMessageId?: string | null;
  lastSyncedAt?: Date;
}): Promise<DiscordReportSync> {
  const now = new Date();
  const [row] = await db
    .insert(discordReportSyncs)
    .values({
      threadChannelId: input.threadChannelId,
      parentChannelId: input.parentChannelId,
      reportType: input.reportType,
      threadName: input.threadName ?? null,
      githubOwner: input.githubOwner,
      githubRepo: input.githubRepo,
      githubIssueNumber: input.githubIssueNumber,
      githubIssueUrl: input.githubIssueUrl,
      createdByDiscordUserId: input.createdByDiscordUserId ?? null,
      lastSyncedMessageId: input.lastSyncedMessageId ?? null,
      lastSyncedAt: input.lastSyncedAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: discordReportSyncs.threadChannelId,
      set: {
        parentChannelId: input.parentChannelId,
        reportType: input.reportType,
        threadName: input.threadName ?? null,
        githubOwner: input.githubOwner,
        githubRepo: input.githubRepo,
        githubIssueNumber: input.githubIssueNumber,
        githubIssueUrl: input.githubIssueUrl,
        createdByDiscordUserId: input.createdByDiscordUserId ?? null,
        lastSyncedMessageId: input.lastSyncedMessageId ?? null,
        lastSyncedAt: input.lastSyncedAt ?? now,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function cleanupExpiredDiscordLinkStates(): Promise<number> {
  const result = await db
    .delete(discordLinkStates)
    .where(and(lt(discordLinkStates.expiresAt, new Date()), isNull(discordLinkStates.consumedAt)));

  return result.rowCount || 0;
}

export async function cleanupExpiredDiscordTradeIntents(): Promise<number> {
  const result = await db
    .delete(discordTradeIntents)
    .where(
      and(lt(discordTradeIntents.expiresAt, new Date()), isNull(discordTradeIntents.consumedAt)),
    );

  return result.rowCount || 0;
}
