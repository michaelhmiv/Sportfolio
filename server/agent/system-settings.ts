import { agentSystemSettings, updateAgentSystemSettingsInputSchema } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  getDefaultManagedProviderKey,
  getManagedProviderStatus,
  getManagedProviderStatuses,
  isManagedProviderKey,
} from "./provider-registry";
import type { AgentSystemSettingsView, ManagedProviderKey } from "./types";

function isMissingAgentSystemSettingsSchemaError(error: unknown): boolean {
  const message = String((error as Error)?.message || "").toLowerCase();
  return (
    (message.includes("relation") || message.includes("column")) &&
    message.includes("does not exist") &&
    message.includes("agent_system_settings")
  );
}

async function withAgentSystemSettingsSchemaBootstrap<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!isMissingAgentSystemSettingsSchemaError(error)) {
      throw error;
    }

    console.warn(
      "[Agent System Settings] Missing schema detected during access, attempting bootstrap + retry.",
    );
    await ensureAgentSystemSettingsSchema();
    return callback();
  }
}

export async function ensureAgentSystemSettingsSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "agent_system_settings" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "managed_provider" text NOT NULL DEFAULT 'minimax',
      "managed_model" text,
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE "agent_system_settings"
      ADD COLUMN IF NOT EXISTS "managed_model" text;
  `);
}

async function ensureAgentSystemSettingsRow() {
  return withAgentSystemSettingsSchemaBootstrap(async () => {
    const [existing] = await db.select().from(agentSystemSettings).limit(1);
    if (existing) {
      if (isManagedProviderKey(existing.managedProvider)) {
        return existing;
      }

      const [updated] = await db
        .update(agentSystemSettings)
        .set({
          managedProvider: getDefaultManagedProviderKey(),
          managedModel: null,
          updatedAt: new Date(),
        })
        .where(eq(agentSystemSettings.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await db
      .insert(agentSystemSettings)
      .values({
        managedProvider: getDefaultManagedProviderKey(),
      })
      .returning();

    return created;
  });
}

function toAgentSystemSettingsView(
  row: typeof agentSystemSettings.$inferSelect,
): AgentSystemSettingsView {
  const managedProvider = isManagedProviderKey(row.managedProvider)
    ? row.managedProvider
    : getDefaultManagedProviderKey();
  const activeProvider = getManagedProviderStatus(managedProvider);
  const effectiveModel = row.managedModel?.trim() || activeProvider.defaultModel;

  return {
    settings: {
      id: row.id,
      managedProvider,
      managedModel: row.managedModel,
      updatedAt: row.updatedAt,
    },
    managedProvider: {
      ...activeProvider,
      defaultModel: effectiveModel,
    },
    managedProviders: getManagedProviderStatuses(),
  };
}

export async function getAgentSystemSettings(): Promise<AgentSystemSettingsView> {
  const row = await ensureAgentSystemSettingsRow();
  return toAgentSystemSettingsView(row);
}

export async function getActiveManagedProviderSelection(): Promise<{
  provider: ManagedProviderKey;
  modelOverride: string | null;
}> {
  const row = await ensureAgentSystemSettingsRow();
  return {
    provider: isManagedProviderKey(row.managedProvider)
      ? row.managedProvider
      : getDefaultManagedProviderKey(),
    modelOverride: row.managedModel?.trim() || null,
  };
}

export async function updateAgentSystemSettings(input: unknown): Promise<AgentSystemSettingsView> {
  const data = updateAgentSystemSettingsInputSchema.parse(input);
  const provider = getManagedProviderStatus(data.managedProvider);
  const effectiveModel = data.managedModel?.trim() || provider.defaultModel;

  if (!provider.configured) {
    throw new Error(`${provider.label} is not configured`);
  }

  if (!effectiveModel) {
    throw new Error(`${provider.label} is missing a default model`);
  }

  if (effectiveModel && provider.models.length > 0 && !provider.models.includes(effectiveModel)) {
    throw new Error(`MiniMax agent planning currently supports: ${provider.models.join(", ")}`);
  }

  const current = await ensureAgentSystemSettingsRow();
  const [updated] = await db
    .update(agentSystemSettings)
    .set({
      managedProvider: data.managedProvider,
      managedModel: data.managedModel || null,
      updatedAt: new Date(),
    })
    .where(eq(agentSystemSettings.id, current.id))
    .returning();

  return toAgentSystemSettingsView(updated);
}
