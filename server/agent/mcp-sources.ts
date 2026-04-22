import { and, eq, sql } from "drizzle-orm";
import { userMcpSources } from "@shared/schema";
import type { UserMcpSource } from "@shared/schema";
import { db } from "../db";

const MAX_MCP_SOURCES_PER_USER = 5;

function isMissingUserMcpSourceSchemaError(error: unknown): boolean {
  const message = String((error as Error)?.message || "").toLowerCase();
  return (
    (message.includes("relation") || message.includes("column")) &&
    message.includes("does not exist") &&
    message.includes("user_mcp_sources")
  );
}

async function withUserMcpSourceSchemaBootstrap<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!isMissingUserMcpSourceSchemaError(error)) {
      throw error;
    }

    console.warn(
      "[Agent MCP Sources] Missing schema detected during access, attempting bootstrap + retry.",
    );
    await ensureUserMcpSourceSchema();
    return callback();
  }
}

export async function ensureUserMcpSourceSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_mcp_sources" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "url" text NOT NULL,
      "auth_type" text NOT NULL DEFAULT 'none',
      "auth_token" text,
      "enabled" boolean NOT NULL DEFAULT true,
      "discovered_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "last_verified_at" timestamp,
      "last_error" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE "user_mcp_sources"
      ADD COLUMN IF NOT EXISTS "auth_type" text NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS "auth_token" text,
      ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "discovered_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "last_verified_at" timestamp,
      ADD COLUMN IF NOT EXISTS "last_error" text,
      ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
  `);

  await db.execute(sql`
    UPDATE "user_mcp_sources"
    SET
      "auth_type" = COALESCE("auth_type", 'none'),
      "enabled" = COALESCE("enabled", true),
      "discovered_tools" = COALESCE("discovered_tools", '[]'::jsonb),
      "updated_at" = COALESCE("updated_at", now())
    WHERE
      "auth_type" IS NULL
      OR "enabled" IS NULL
      OR "discovered_tools" IS NULL
      OR "updated_at" IS NULL;
  `);

  await db.execute(sql`
    ALTER TABLE "user_mcp_sources"
      ALTER COLUMN "auth_type" SET DEFAULT 'none',
      ALTER COLUMN "auth_type" SET NOT NULL,
      ALTER COLUMN "enabled" SET DEFAULT true,
      ALTER COLUMN "enabled" SET NOT NULL,
      ALTER COLUMN "discovered_tools" SET DEFAULT '[]'::jsonb,
      ALTER COLUMN "discovered_tools" SET NOT NULL,
      ALTER COLUMN "updated_at" SET DEFAULT now(),
      ALTER COLUMN "updated_at" SET NOT NULL;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_mcp_sources_user_idx"
      ON "user_mcp_sources" ("user_id");
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_mcp_sources_user_enabled_idx"
      ON "user_mcp_sources" ("user_id", "enabled");
  `);
}

export async function listUserMcpSources(userId: string): Promise<UserMcpSource[]> {
  return withUserMcpSourceSchemaBootstrap(() =>
    db
      .select()
      .from(userMcpSources)
      .where(eq(userMcpSources.userId, userId))
      .orderBy(userMcpSources.createdAt),
  );
}

export async function getUserMcpSource(
  userId: string,
  sourceId: string,
): Promise<UserMcpSource | null> {
  return withUserMcpSourceSchemaBootstrap(async () => {
    const [source] = await db
      .select()
      .from(userMcpSources)
      .where(and(eq(userMcpSources.id, sourceId), eq(userMcpSources.userId, userId)))
      .limit(1);
    return source || null;
  });
}

export async function createUserMcpSource(
  userId: string,
  input: { name: string; url: string; authType?: string; authToken?: string },
): Promise<UserMcpSource> {
  return withUserMcpSourceSchemaBootstrap(async () => {
    const existing = await db
      .select({ id: userMcpSources.id })
      .from(userMcpSources)
      .where(eq(userMcpSources.userId, userId));

    if (existing.length >= MAX_MCP_SOURCES_PER_USER) {
      throw new Error(`Maximum of ${MAX_MCP_SOURCES_PER_USER} MCP sources allowed per user.`);
    }

    const url = input.url.trim();
    if (!url.startsWith("https://")) {
      throw new Error("MCP source URL must use HTTPS.");
    }

    const [source] = await db
      .insert(userMcpSources)
      .values({
        userId,
        name: input.name.trim(),
        url,
        authType: input.authType || "none",
        authToken: input.authToken || null,
      })
      .returning();

    return source;
  });
}

export async function updateUserMcpSource(
  userId: string,
  sourceId: string,
  input: { name?: string; url?: string; authType?: string; authToken?: string; enabled?: boolean },
): Promise<UserMcpSource> {
  return withUserMcpSourceSchemaBootstrap(async () => {
    const existing = await getUserMcpSource(userId, sourceId);
    if (!existing) {
      throw new Error("MCP source not found.");
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.url !== undefined) {
      const url = input.url.trim();
      if (!url.startsWith("https://")) {
        throw new Error("MCP source URL must use HTTPS.");
      }
      updates.url = url;
    }
    if (input.authType !== undefined) updates.authType = input.authType;
    if (input.authToken !== undefined) updates.authToken = input.authToken;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    const [updated] = await db
      .update(userMcpSources)
      .set(updates)
      .where(and(eq(userMcpSources.id, sourceId), eq(userMcpSources.userId, userId)))
      .returning();

    return updated;
  });
}

export async function deleteUserMcpSource(userId: string, sourceId: string): Promise<void> {
  await withUserMcpSourceSchemaBootstrap(async () => {
    const existing = await getUserMcpSource(userId, sourceId);
    if (!existing) {
      throw new Error("MCP source not found.");
    }

    await db
      .delete(userMcpSources)
      .where(and(eq(userMcpSources.id, sourceId), eq(userMcpSources.userId, userId)));
  });
}
