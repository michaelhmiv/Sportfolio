import { eq, and } from "drizzle-orm";
import { userMcpSources } from "@shared/schema";
import type { UserMcpSource } from "@shared/schema";
import { db } from "../db";

const MAX_MCP_SOURCES_PER_USER = 5;

export async function listUserMcpSources(userId: string): Promise<UserMcpSource[]> {
  return db
    .select()
    .from(userMcpSources)
    .where(eq(userMcpSources.userId, userId))
    .orderBy(userMcpSources.createdAt);
}

export async function getUserMcpSource(
  userId: string,
  sourceId: string,
): Promise<UserMcpSource | null> {
  const [source] = await db
    .select()
    .from(userMcpSources)
    .where(and(eq(userMcpSources.id, sourceId), eq(userMcpSources.userId, userId)))
    .limit(1);
  return source || null;
}

export async function createUserMcpSource(
  userId: string,
  input: { name: string; url: string; authType?: string; authToken?: string },
): Promise<UserMcpSource> {
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
}

export async function updateUserMcpSource(
  userId: string,
  sourceId: string,
  input: { name?: string; url?: string; authType?: string; authToken?: string; enabled?: boolean },
): Promise<UserMcpSource> {
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
}

export async function deleteUserMcpSource(userId: string, sourceId: string): Promise<void> {
  const existing = await getUserMcpSource(userId, sourceId);
  if (!existing) {
    throw new Error("MCP source not found.");
  }

  await db
    .delete(userMcpSources)
    .where(and(eq(userMcpSources.id, sourceId), eq(userMcpSources.userId, userId)));
}
