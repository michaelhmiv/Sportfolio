import { userAgentProfiles, type UserAgentProfile, type UserMcpSource } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { INTERNAL_MLB_MCP_SOURCE_ID, getInternalMlbMcpStatus } from "./internal-mlb-mcp";
import { getUserMcpSource, listUserMcpSources, updateUserMcpSource } from "./mcp-sources";
import type {
  AgentDataSourceCapabilityView,
  AgentDataSourceSummaryView,
  AgentDataSourceView,
} from "./types";

const INTERNAL_MLB_MCP_NAME = "MLB Data Feed";
const INTERNAL_MLB_MCP_DESCRIPTION =
  "Built-in in-house MLB data for Hermes. This source is only available through Hermes and is not exposed as a public MCP endpoint.";
const INTERNAL_MLB_MCP_CAPABILITY_SUMMARY =
  "In-house MLB data and leaderboard context available through Hermes-only tools.";

function toExternalDataSourceView(source: UserMcpSource): AgentDataSourceView {
  return {
    id: source.id,
    kind: "external",
    name: source.name,
    description: "User-connected external MCP source.",
    enabled: source.enabled,
    available: source.enabled && !source.lastError,
    authType: source.authType,
    url: source.url,
    lastVerifiedAt: source.lastVerifiedAt,
    lastError: source.lastError,
    createdAt: source.createdAt,
    editable: true,
    removable: true,
    capabilitySummary: `External MCP source ${source.name}.`,
  };
}

function toCapabilityView(source: AgentDataSourceView): AgentDataSourceCapabilityView {
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    description: source.description,
    enabled: source.enabled,
    available: source.available,
    capabilitySummary: source.capabilitySummary,
  };
}

export async function getInternalMlbDataSourceView(
  profile: UserAgentProfile,
): Promise<AgentDataSourceView> {
  const status = await getInternalMlbMcpStatus();

  return {
    id: INTERNAL_MLB_MCP_SOURCE_ID,
    kind: "built_in",
    name: INTERNAL_MLB_MCP_NAME,
    description: INTERNAL_MLB_MCP_DESCRIPTION,
    enabled: profile.internalMlbMcpEnabled,
    available: status.available,
    authType: "internal",
    url: null,
    lastVerifiedAt: null,
    lastError: null,
    createdAt: profile.createdAt,
    editable: false,
    removable: false,
    capabilitySummary:
      status.toolCount > 0
        ? `${INTERNAL_MLB_MCP_CAPABILITY_SUMMARY} ${status.toolCount} tool${status.toolCount === 1 ? "" : "s"} projected.`
        : INTERNAL_MLB_MCP_CAPABILITY_SUMMARY,
  };
}

export async function listAgentDataSources(
  userId: string,
  profile: UserAgentProfile,
): Promise<AgentDataSourceView[]> {
  const [builtIn, external] = await Promise.all([
    getInternalMlbDataSourceView(profile),
    listUserMcpSources(userId),
  ]);

  return [builtIn, ...external.map(toExternalDataSourceView)];
}

export async function getAgentDataSource(
  userId: string,
  sourceId: string,
  profile: UserAgentProfile,
): Promise<AgentDataSourceView | null> {
  if (sourceId === INTERNAL_MLB_MCP_SOURCE_ID) {
    return getInternalMlbDataSourceView(profile);
  }

  const source = await getUserMcpSource(userId, sourceId);
  return source ? toExternalDataSourceView(source) : null;
}

export async function getAgentDataSourceSummary(
  userId: string,
  profile: UserAgentProfile,
): Promise<AgentDataSourceSummaryView> {
  const sources = await listAgentDataSources(userId, profile);

  return {
    builtIn: sources.filter((source) => source.kind === "built_in").map(toCapabilityView),
    external: sources.filter((source) => source.kind === "external").map(toCapabilityView),
  };
}

export async function updateAgentDataSource(
  userId: string,
  sourceId: string,
  input: { name?: string; url?: string; authType?: string; authToken?: string; enabled?: boolean },
): Promise<AgentDataSourceView> {
  if (sourceId === INTERNAL_MLB_MCP_SOURCE_ID) {
    if (input.enabled === undefined) {
      throw new Error("Built-in data sources only support enabled updates.");
    }

    const disallowedKeys = ["name", "url", "authType", "authToken"].filter(
      (key) => (input as Record<string, unknown>)[key] !== undefined,
    );
    if (disallowedKeys.length > 0) {
      throw new Error("Built-in data sources cannot be renamed or reconfigured.");
    }

    const [profile] = await db
      .update(userAgentProfiles)
      .set({
        internalMlbMcpEnabled: input.enabled,
        updatedAt: new Date(),
      })
      .where(eq(userAgentProfiles.userId, userId))
      .returning();

    if (!profile) {
      throw new Error("Agent profile not found.");
    }

    return getInternalMlbDataSourceView(profile);
  }

  const source = await updateUserMcpSource(userId, sourceId, input);
  return toExternalDataSourceView(source);
}
