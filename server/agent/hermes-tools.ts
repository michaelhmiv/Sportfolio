import { getAgentCapabilities, getScoutAgentProfile } from "./service";
import { loadScoutAgentContext } from "./context-loader";
import { listAgentKnowledgeArticles } from "../docs-service";
import {
  buildHermesMemoryContext,
  persistProposedMemoryWrites,
  archiveUserAgentMemory,
} from "./memory";
import { getAgentThread, listAgentThreadMessages } from "./thread-service";
import { planDirectAgentOperation } from "./operations-planner";
import { planHostedWebResearch } from "./research";
import type { ProposedMemoryWrite } from "./types";

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function runHermesReadTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "get_agent_capabilities":
      return getAgentCapabilities(input.userId);
    case "get_thread_state":
      if (!input.threadId) {
        throw new Error("threadId is required for get_thread_state");
      }

      return {
        thread: await getAgentThread(input.userId, input.threadId),
        messages: await listAgentThreadMessages(input.userId, input.threadId),
      };
    case "get_portfolio_summary": {
      const profile = (await getScoutAgentProfile(input.userId)).profile;
      const context = await loadScoutAgentContext(input.userId, profile, {
        chatRequest: toStringValue(input.args?.message),
      });

      return {
        operatorOverview: context.operatorOverview,
        selectionWindow: context.selectionWindow,
        recommendedTargets: context.recommendedTargets,
      };
    }
    case "get_canonical_knowledge":
      return listAgentKnowledgeArticles(true);
    case "get_hosted_research": {
      const profile = (await getScoutAgentProfile(input.userId)).profile;
      const message = toStringValue(input.args?.message);
      if (!message) {
        throw new Error("message is required for get_hosted_research");
      }

      return planHostedWebResearch({
        message,
        profile,
      });
    }
    case "list_user_memories":
      return buildHermesMemoryContext({
        userId: input.userId,
        query: toStringValue(input.args?.query),
      });
    default:
      throw new Error(`Unsupported Hermes read tool: ${input.toolName}`);
  }
}

export async function runHermesPlanTool(input: {
  toolName: string;
  userId: string;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "preview_direct_operation": {
      const profile = (await getScoutAgentProfile(input.userId)).profile;
      const message = toStringValue(input.args?.message);
      if (!message) {
        throw new Error("message is required for preview_direct_operation");
      }

      return planDirectAgentOperation({
        userId: input.userId,
        message,
        profile,
      });
    }
    default:
      throw new Error(`Unsupported Hermes plan tool: ${input.toolName}`);
  }
}

export async function runHermesMemoryTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "write_user_memory": {
      const writes = Array.isArray(input.args?.writes)
        ? (input.args?.writes as ProposedMemoryWrite[])
        : [];

      return persistProposedMemoryWrites({
        userId: input.userId,
        threadId: input.threadId || null,
        writes,
      });
    }
    case "archive_user_memory": {
      const memoryId = toStringValue(input.args?.memoryId);
      if (!memoryId) {
        throw new Error("memoryId is required for archive_user_memory");
      }

      return archiveUserAgentMemory(input.userId, memoryId);
    }
    default:
      throw new Error(`Unsupported Hermes memory tool: ${input.toolName}`);
  }
}
