import {
  userAgentActionBundles,
  userAgentMessageEmbeddings,
  userAgentMessages,
  userAgentProposals,
  userAgentStrategies,
  userAgentThreads,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { normalizeAgentUiBlocks } from "./ui-blocks";
import {
  hydrateClarificationMessage,
  parsePendingClarification,
  shouldTreatAsClarificationReply,
} from "./clarification";
import { executeAgentActions } from "./executor";
import {
  analyzePortfolioAgent,
  approvePortfolioAgentRun,
  markAgentRunRejected,
  rejectPortfolioAgentRun,
} from "./service";
import { ensureDefaultUserAgentSchedules } from "./schedules";
import {
  backfillRecentAgentMessageEmbeddings,
  buildAgentQuestionRouteCounts,
  buildAgentQuestionSemanticClusters,
  normalizeAgentQuestionText,
  recordAgentMessageEmbedding,
} from "./semantic-router";
import {
  buildWorkflowPayload,
  getBundleActions,
  getBundlePendingClarification,
  getBundleWorkflowView,
} from "./workflow-bundle";
import type {
  AgentAction,
  AgentActionBundleView,
  AgentChannel,
  AgentCitation,
  AgentConfirmationPreview,
  AgentDomain,
  AgentPendingClarification,
  AgentQuestionLogReport,
  AgentScheduleJobType,
  AgentThreadMessage,
  AgentThreadSummary,
  AgentThreadTurnResult,
  AgentThreadWorkspace,
  AgentToolTrace,
} from "./types";

const createThreadInputSchema = z
  .object({
    channel: z.enum(["in_app", "sms", "cli"]).optional(),
    domain: z
      .enum([
        "scouting",
        "player_pools",
        "daily_boosts",
        "community_boosts",
        "watchlists",
        "sportfolio",
      ])
      .optional(),
    title: z.string().trim().min(1).max(120).optional(),
    workspace: z.enum(["chat", "strategy"]).optional(),
    strategyId: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict();

const threadMessageInputSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
  })
  .strict();

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getThreadWorkspace(value: unknown): AgentThreadWorkspace {
  const metadata = toRecord(value);
  return metadata.workspace === "strategy" ? "strategy" : "chat";
}

function getThreadStrategyId(value: unknown): string | null {
  const metadata = toRecord(value);
  return typeof metadata.strategyId === "string" && metadata.strategyId.trim().length > 0
    ? metadata.strategyId.trim()
    : null;
}

function buildThreadMetadata(input: {
  existing?: unknown;
  workspace?: AgentThreadWorkspace;
  strategyId?: string | null;
}) {
  const next = toRecord(input.existing);
  if (input.workspace) {
    next.workspace = input.workspace;
  }
  if (input.strategyId !== undefined) {
    if (input.strategyId) {
      next.strategyId = input.strategyId;
    } else {
      delete next.strategyId;
    }
  }

  return next;
}

export async function ensureAgentThreadSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_profiles" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "enabled" boolean NOT NULL DEFAULT true,
      "display_name" text NOT NULL DEFAULT 'My Portfolio Operator',
      "provider_mode" text NOT NULL DEFAULT 'managed',
      "provider_type" text NOT NULL DEFAULT 'openai_compatible',
      "runtime" text NOT NULL DEFAULT 'hermes',
      "model" text NOT NULL DEFAULT 'managed-default',
      "base_url" text,
      "internal_mlb_mcp_enabled" boolean NOT NULL DEFAULT true,
      "system_prompt" text NOT NULL DEFAULT 'You are Hermes, Sportfolio''s product operator. Stay inside Sportfolio gameplay and user experience: portfolio state, player markets, liquidity, boosts, scouts, watchlists, lineups, schedules, stats, and guardrailed strategies. Use Sportfolio-native tools as the source of truth for account and gameplay state. Treat built-in or user-connected MCP sources as optional enrichment after native Sportfolio context, not as canonical state. Keep the focus on the next useful Sportfolio decision instead of acting like a general personal assistant. Never imply access to code, arbitrary database state, files, or admin-only systems. When a request would change gameplay state, preview or stage it through the server-owned confirmation boundary instead of bypassing validation.',
      "user_prompt_template" text NOT NULL DEFAULT 'Act like my Sportfolio portfolio operator. Keep me focused on the highest-signal Sportfolio decision, use lineups, schedules, stats, and news only when they change what I should do, and turn direct requests into the safest staged move the current Hermes tools support.',
      "temperature" numeric(3, 2) NOT NULL DEFAULT 0.20,
      "max_tokens" integer NOT NULL DEFAULT 1200,
      "analysis_window_minutes" integer NOT NULL DEFAULT 1440,
      "default_sport" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE "user_agent_profiles"
      ADD COLUMN IF NOT EXISTS "runtime" text NOT NULL DEFAULT 'hermes';
  `);

  await db.execute(sql`
    ALTER TABLE "user_agent_profiles"
      ADD COLUMN IF NOT EXISTS "internal_mlb_mcp_enabled" boolean NOT NULL DEFAULT true;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_secrets" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "api_key_ciphertext" text NOT NULL,
      "api_key_iv" text NOT NULL,
      "api_key_auth_tag" text NOT NULL,
      "key_last4" text NOT NULL,
      "encryption_version" text NOT NULL DEFAULT 'aes-256-gcm:v1',
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now(),
      "rotated_at" timestamp
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_runs" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "trigger_source" text NOT NULL DEFAULT 'manual',
      "status" text NOT NULL DEFAULT 'pending',
      "provider_mode" text NOT NULL DEFAULT 'managed',
      "model" text NOT NULL,
      "context_snapshot" jsonb NOT NULL,
      "prompt_snapshot" jsonb NOT NULL,
      "raw_response" jsonb,
      "parsed_summary" text,
      "error_message" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "completed_at" timestamp
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_proposals" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "run_id" varchar NOT NULL REFERENCES "user_agent_runs"("id") ON DELETE CASCADE,
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "action_type" text NOT NULL DEFAULT 'scout_set_count',
      "status" text NOT NULL DEFAULT 'proposed',
      "player_id" varchar REFERENCES "players"("id") ON DELETE NO ACTION,
      "target_count" integer,
      "current_count" integer,
      "reasoning" text NOT NULL,
      "confidence" numeric(4, 3) NOT NULL DEFAULT 0.500,
      "evidence" jsonb NOT NULL,
      "risk_flags" jsonb NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "approved_at" timestamp,
      "applied_at" timestamp,
      "error_message" text
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_improvement_candidates" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "signature" text NOT NULL,
      "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "source_run_id" varchar REFERENCES "user_agent_runs"("id") ON DELETE SET NULL,
      "status" text NOT NULL DEFAULT 'new',
      "failure_class" text NOT NULL,
      "recommended_change_type" text NOT NULL,
      "recommended_change" text NOT NULL,
      "affected_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "confidence" numeric(4, 3) NOT NULL DEFAULT 0.500,
      "occurrence_count" integer NOT NULL DEFAULT 1,
      "last_seen_at" timestamp NOT NULL DEFAULT now(),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_threads" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "channel" text NOT NULL DEFAULT 'in_app',
      "domain" text NOT NULL DEFAULT 'sportfolio',
      "status" text NOT NULL DEFAULT 'active',
      "title" text,
      "external_thread_key" text,
      "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "last_message_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE "user_agent_threads"
      ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
  `);

  await db.execute(sql`
    ALTER TABLE "user_agent_runs"
      ADD COLUMN IF NOT EXISTS "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_action_bundles" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "thread_id" varchar NOT NULL REFERENCES "user_agent_threads"("id") ON DELETE CASCADE,
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "domain" text NOT NULL DEFAULT 'scouting',
      "run_id" varchar REFERENCES "user_agent_runs"("id") ON DELETE SET NULL,
      "status" text NOT NULL DEFAULT 'pending_confirmation',
      "summary" text NOT NULL,
      "warnings" jsonb NOT NULL,
      "action_payload" jsonb NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "confirmed_at" timestamp,
      "applied_at" timestamp,
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_messages" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "thread_id" varchar NOT NULL REFERENCES "user_agent_threads"("id") ON DELETE CASCADE,
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "role" text NOT NULL,
      "message_type" text NOT NULL DEFAULT 'chat',
      "content_text" text NOT NULL,
      "structured_payload" jsonb,
      "run_id" varchar REFERENCES "user_agent_runs"("id") ON DELETE SET NULL,
      "action_bundle_id" varchar REFERENCES "user_agent_action_bundles"("id") ON DELETE SET NULL,
      "external_message_key" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_memories" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
      "scope" text NOT NULL,
      "kind" text NOT NULL,
      "summary" text NOT NULL,
      "content" jsonb NOT NULL,
      "confidence" numeric(4, 3) NOT NULL DEFAULT 0.500,
      "source" text NOT NULL,
      "embedding" jsonb,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now(),
      "archived_at" timestamp
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "agent_runtime_sessions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
      "runtime" text NOT NULL,
      "status" text NOT NULL,
      "request_payload" jsonb,
      "response_payload" jsonb,
      "tool_trace" jsonb,
      "latency_ms" integer,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_schedules" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "job_type" text NOT NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "schedule_cron" text NOT NULL,
      "channel_targets" jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
      "policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "last_run_at" timestamp,
      "next_run_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_profiles_user_idx"
      ON "user_agent_profiles" ("user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_profiles_provider_mode_idx"
      ON "user_agent_profiles" ("provider_mode");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_profiles_runtime_idx"
      ON "user_agent_profiles" ("runtime");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_profiles_updated_at_idx"
      ON "user_agent_profiles" ("updated_at");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_secrets_user_idx"
      ON "user_agent_secrets" ("user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_secrets_updated_at_idx"
      ON "user_agent_secrets" ("updated_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_threads_user_updated_idx"
      ON "user_agent_threads" ("user_id", "updated_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_threads_user_status_idx"
      ON "user_agent_threads" ("user_id", "status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_threads_channel_idx"
      ON "user_agent_threads" ("channel");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_runs_user_created_idx"
      ON "user_agent_runs" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_runs_status_idx"
      ON "user_agent_runs" ("status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_runs_thread_created_idx"
      ON "user_agent_runs" ("thread_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_proposals_run_idx"
      ON "user_agent_proposals" ("run_id");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_improvement_candidates_signature_idx"
      ON "user_agent_improvement_candidates" ("signature");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_improvement_candidates_status_seen_idx"
      ON "user_agent_improvement_candidates" ("status", "last_seen_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_improvement_candidates_failure_seen_idx"
      ON "user_agent_improvement_candidates" ("failure_class", "last_seen_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_proposals_user_status_created_idx"
      ON "user_agent_proposals" ("user_id", "status", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_action_bundles_thread_status_idx"
      ON "user_agent_action_bundles" ("thread_id", "status", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_action_bundles_user_created_idx"
      ON "user_agent_action_bundles" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_messages_thread_created_idx"
      ON "user_agent_messages" ("thread_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_messages_user_created_idx"
      ON "user_agent_messages" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_messages_action_bundle_idx"
      ON "user_agent_messages" ("action_bundle_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_memories_user_scope_updated_idx"
      ON "user_agent_memories" ("user_id", "scope", "updated_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_memories_user_kind_updated_idx"
      ON "user_agent_memories" ("user_id", "kind", "updated_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_memories_thread_idx"
      ON "user_agent_memories" ("thread_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_memories_active_idx"
      ON "user_agent_memories" ("user_id", "archived_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_user_created_idx"
      ON "agent_runtime_sessions" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_thread_created_idx"
      ON "agent_runtime_sessions" ("thread_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_runtime_created_idx"
      ON "agent_runtime_sessions" ("runtime", "created_at");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_schedules_user_job_idx"
      ON "user_agent_schedules" ("user_id", "job_type");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_schedules_due_run_idx"
      ON "user_agent_schedules" ("enabled", "next_run_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_schedules_user_updated_idx"
      ON "user_agent_schedules" ("user_id", "updated_at");
  `);
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function sanitizeAgentActions(value: unknown): AgentAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object"),
    )
    .map((entry) => {
      const actionType =
        typeof entry.actionType === "string" ? entry.actionType : "scout_set_count";
      const base = {
        playerId: typeof entry.playerId === "string" ? entry.playerId : "",
        playerName: typeof entry.playerName === "string" ? entry.playerName : undefined,
        status: typeof entry.status === "string" ? entry.status : undefined,
        reasoning: typeof entry.reasoning === "string" ? entry.reasoning : "",
        confidence: typeof entry.confidence === "number" ? entry.confidence : 0,
      };

      switch (actionType) {
        case "pool_buy":
          return {
            ...base,
            actionType,
            sbAmount: typeof entry.sbAmount === "number" ? entry.sbAmount : 0,
            maxSlippage: typeof entry.maxSlippage === "number" ? entry.maxSlippage : 0.05,
            estimatedSharesOut:
              typeof entry.estimatedSharesOut === "number" ? entry.estimatedSharesOut : null,
            estimatedPricePerShare:
              typeof entry.estimatedPricePerShare === "number"
                ? entry.estimatedPricePerShare
                : null,
            estimatedSlippagePercent:
              typeof entry.estimatedSlippagePercent === "number"
                ? entry.estimatedSlippagePercent
                : null,
          } as const;
        case "pool_sell":
          return {
            ...base,
            actionType,
            sharesAmount: typeof entry.sharesAmount === "number" ? entry.sharesAmount : 0,
            maxSlippage: typeof entry.maxSlippage === "number" ? entry.maxSlippage : 0.05,
            estimatedSbOut: typeof entry.estimatedSbOut === "number" ? entry.estimatedSbOut : null,
            estimatedPricePerShare:
              typeof entry.estimatedPricePerShare === "number"
                ? entry.estimatedPricePerShare
                : null,
            estimatedSlippagePercent:
              typeof entry.estimatedSlippagePercent === "number"
                ? entry.estimatedSlippagePercent
                : null,
          } as const;
        case "pool_add_liquidity":
          return {
            ...base,
            actionType,
            shares: typeof entry.shares === "number" ? entry.shares : 0,
            playMoney: typeof entry.playMoney === "number" ? entry.playMoney : 0,
            estimatedOwnershipPercent:
              typeof entry.estimatedOwnershipPercent === "number"
                ? entry.estimatedOwnershipPercent
                : null,
          } as const;
        case "pool_add_liquidity_optimal":
          return {
            ...base,
            actionType,
            maxShares: typeof entry.maxShares === "number" ? entry.maxShares : 0,
            maxPlayMoney: typeof entry.maxPlayMoney === "number" ? entry.maxPlayMoney : 0,
            estimatedOwnershipPercent:
              typeof entry.estimatedOwnershipPercent === "number"
                ? entry.estimatedOwnershipPercent
                : null,
          } as const;
        case "pool_zap_add_shares":
          return {
            ...base,
            actionType,
            shares: typeof entry.shares === "number" ? entry.shares : 0,
            estimatedLpSharesMinted:
              typeof entry.estimatedLpSharesMinted === "number"
                ? entry.estimatedLpSharesMinted
                : null,
          } as const;
        case "pool_zap_add_sb":
          return {
            ...base,
            actionType,
            sb: typeof entry.sb === "number" ? entry.sb : 0,
            estimatedLpSharesMinted:
              typeof entry.estimatedLpSharesMinted === "number"
                ? entry.estimatedLpSharesMinted
                : null,
          } as const;
        case "pool_remove_liquidity":
          return {
            ...base,
            actionType,
            lpShares: typeof entry.lpShares === "number" ? entry.lpShares : 0,
            estimatedSharesOut:
              typeof entry.estimatedSharesOut === "number" ? entry.estimatedSharesOut : null,
            estimatedPlayMoneyOut:
              typeof entry.estimatedPlayMoneyOut === "number" ? entry.estimatedPlayMoneyOut : null,
          } as const;
        case "holdings_stack_shares":
          return {
            ...base,
            actionType,
            sharesToStack: typeof entry.sharesToStack === "number" ? entry.sharesToStack : 0,
            expectedMultiplierGained:
              typeof entry.expectedMultiplierGained === "number"
                ? entry.expectedMultiplierGained
                : 0,
            expectedStackedShareCount:
              typeof entry.expectedStackedShareCount === "number"
                ? entry.expectedStackedShareCount
                : 0,
          } as const;
        case "daily_boost_assign":
          return {
            ...base,
            actionType,
            sport: typeof entry.sport === "string" ? entry.sport : "NBA",
            slotTier: [2, 3, 4, 5].includes(Number(entry.slotTier))
              ? (Number(entry.slotTier) as 2 | 3 | 4 | 5)
              : 2,
            sharesEntered: 1 as const,
            boostDate: typeof entry.boostDate === "string" ? entry.boostDate : "",
            gameId: typeof entry.gameId === "string" ? entry.gameId : "",
            gameStartTime: typeof entry.gameStartTime === "string" ? entry.gameStartTime : null,
            opponent: typeof entry.opponent === "string" ? entry.opponent : null,
            availableShares:
              typeof entry.availableShares === "number" ? entry.availableShares : undefined,
          } as const;
        case "daily_boost_remove":
          return {
            ...base,
            actionType,
            boostId: typeof entry.boostId === "string" ? entry.boostId : "",
            sport: typeof entry.sport === "string" ? entry.sport : "NBA",
            slotTier: [2, 3, 4, 5].includes(Number(entry.slotTier))
              ? (Number(entry.slotTier) as 2 | 3 | 4 | 5)
              : 2,
            boostDate: typeof entry.boostDate === "string" ? entry.boostDate : "",
            gameId: typeof entry.gameId === "string" ? entry.gameId : null,
            gameStartTime: typeof entry.gameStartTime === "string" ? entry.gameStartTime : null,
          } as const;
        case "watchlist_add_player":
          return {
            ...base,
            actionType,
            watchlistId: typeof entry.watchlistId === "string" ? entry.watchlistId : null,
            watchlistName: typeof entry.watchlistName === "string" ? entry.watchlistName : null,
          } as const;
        case "watchlist_remove_player":
          return {
            ...base,
            actionType,
            watchlistId: typeof entry.watchlistId === "string" ? entry.watchlistId : null,
            watchlistName: typeof entry.watchlistName === "string" ? entry.watchlistName : null,
            removeFromAll: Boolean(entry.removeFromAll),
          } as const;
        case "community_boost_create":
          return {
            ...base,
            actionType,
            sport: typeof entry.sport === "string" ? entry.sport : "NBA",
            boostDate: typeof entry.boostDate === "string" ? entry.boostDate : "",
            gameId: typeof entry.gameId === "string" ? entry.gameId : "",
            gameStartTime: typeof entry.gameStartTime === "string" ? entry.gameStartTime : null,
            opponent: typeof entry.opponent === "string" ? entry.opponent : null,
            communitySharesAvailable:
              typeof entry.communitySharesAvailable === "number"
                ? entry.communitySharesAvailable
                : undefined,
          } as const;
        case "scout_set_count":
          return {
            ...base,
            actionType: "scout_set_count" as const,
            targetCount: typeof entry.targetCount === "number" ? entry.targetCount : 0,
            currentCount: typeof entry.currentCount === "number" ? entry.currentCount : 0,
            evidence:
              entry.evidence && typeof entry.evidence === "object"
                ? (entry.evidence as Record<string, string | null>)
                : {
                    trend: null,
                    injury: null,
                    upcomingGame: null,
                    performanceNote: null,
                  },
            riskFlags: Array.isArray(entry.riskFlags)
              ? entry.riskFlags.filter((flag): flag is string => typeof flag === "string")
              : [],
          } as const;
        default:
          return null;
      }
    }) as Array<AgentAction | null>;

  return normalized
    .filter((entry): entry is AgentAction => entry !== null)
    .filter((entry) => {
      if ("boostId" in entry) {
        return Boolean(entry.boostId);
      }

      return Boolean(entry.playerId);
    });
}

function mapActionBundleRowToView(
  row: typeof userAgentActionBundles.$inferSelect,
): AgentActionBundleView {
  const normalizedPayload = Array.isArray(row.actionPayload)
    ? sanitizeAgentActions(row.actionPayload)
    : row.actionPayload;
  const workflowView = getBundleWorkflowView({
    rawPayload: normalizedPayload,
    bundleStatus: row.status as AgentActionBundleView["status"],
  });

  return {
    id: row.id,
    status: row.status as AgentActionBundleView["status"],
    domain: row.domain as AgentDomain,
    summary: row.summary,
    warnings: sanitizeStringArray(row.warnings),
    actions: workflowView.actions,
    workflowType: workflowView.workflowType,
    steps: workflowView.steps,
    pendingClarification: workflowView.pendingClarification,
    runId: row.runId || null,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    appliedAt: row.appliedAt,
  };
}

function extractPendingClarification(value: unknown): AgentPendingClarification | null {
  return parsePendingClarification(value);
}

function sanitizeAgentCitations(value: unknown): AgentCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object"),
    )
    .map((entry, index) => {
      const title = typeof entry.title === "string" ? entry.title.trim() : "";
      const sourceName = typeof entry.sourceName === "string" ? entry.sourceName.trim() : "";
      const url = typeof entry.url === "string" ? entry.url.trim() : "";
      const retrievedAt = typeof entry.retrievedAt === "string" ? entry.retrievedAt.trim() : "";
      const factSummary = typeof entry.factSummary === "string" ? entry.factSummary.trim() : "";

      if (!title || !sourceName || !url || !retrievedAt || !factSummary) {
        return null;
      }

      return {
        id:
          typeof entry.id === "string" && entry.id.trim()
            ? entry.id.trim()
            : `citation-${index + 1}`,
        title,
        sourceName,
        url,
        publishedAt:
          typeof entry.publishedAt === "string" ? entry.publishedAt.trim() || null : null,
        retrievedAt,
        factSummary,
        relevanceScore: typeof entry.relevanceScore === "number" ? entry.relevanceScore : 0,
      } satisfies AgentCitation;
    })
    .filter((entry): entry is AgentCitation => Boolean(entry));
}

function extractCitations(value: unknown): AgentCitation[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  return sanitizeAgentCitations(record.citations);
}

function sanitizeToolTrace(value: unknown): AgentToolTrace[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: AgentToolTrace[] = [];

  for (const rawEntry of value) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;
    const toolName = typeof entry.toolName === "string" ? entry.toolName.trim() : "";
    const phase =
      entry.phase === "read" ||
      entry.phase === "scan" ||
      entry.phase === "plan" ||
      entry.phase === "action" ||
      entry.phase === "memory" ||
      entry.phase === "research"
        ? entry.phase
        : null;
    const status =
      entry.status === "ok" || entry.status === "failed" || entry.status === "skipped"
        ? entry.status
        : null;
    const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
    const latencyMs =
      typeof entry.latencyMs === "number" && Number.isFinite(entry.latencyMs)
        ? Math.max(0, entry.latencyMs)
        : 0;

    if (!toolName || !phase || !status || !summary) {
      continue;
    }

    normalized.push({
      toolName,
      phase,
      status,
      latencyMs,
      summary,
      details:
        entry.details && typeof entry.details === "object" && !Array.isArray(entry.details)
          ? (entry.details as Record<string, unknown>)
          : null,
    });
  }

  return normalized;
}

function extractToolTrace(value: unknown): AgentToolTrace[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return sanitizeToolTrace((value as Record<string, unknown>).toolTrace);
}

function extractStringListField(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return sanitizeStringArray((value as Record<string, unknown>)[key]);
}

function extractUiBlocks(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return normalizeAgentUiBlocks((value as Record<string, unknown>).uiBlocks);
}

function extractGeneratedBy(value: unknown): AgentThreadMessage["generatedBy"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const generatedBy = (value as Record<string, unknown>).generatedBy;
  return generatedBy === "user" ||
    generatedBy === "assistant" ||
    generatedBy === "hermes_schedule" ||
    generatedBy === "hermes_strategy"
    ? generatedBy
    : null;
}

function extractScheduleJobType(value: unknown): AgentScheduleJobType | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const jobType = (value as Record<string, unknown>).scheduleJobType;
  return jobType === "daily_setup_review" ||
    jobType === "pre_lock_nudge" ||
    jobType === "injury_watch" ||
    jobType === "idle_balance_nudge" ||
    jobType === "boost_window"
    ? jobType
    : null;
}

function extractConfirmationPreview(value: unknown): AgentConfirmationPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const rawPreview = (value as Record<string, unknown>).confirmationPreview;
  if (!rawPreview || typeof rawPreview !== "object" || Array.isArray(rawPreview)) {
    return null;
  }

  const preview = rawPreview as Record<string, unknown>;
  const actionSummary =
    typeof preview.actionSummary === "string" ? preview.actionSummary.trim() : "";
  const beforeState =
    preview.beforeState &&
    typeof preview.beforeState === "object" &&
    !Array.isArray(preview.beforeState)
      ? (preview.beforeState as Record<string, unknown>)
      : {};
  const afterState =
    preview.afterState &&
    typeof preview.afterState === "object" &&
    !Array.isArray(preview.afterState)
      ? (preview.afterState as Record<string, unknown>)
      : {};
  const warnings = sanitizeStringArray(preview.warnings);
  const riskClass =
    preview.riskClass === "low" || preview.riskClass === "medium" || preview.riskClass === "high"
      ? preview.riskClass
      : null;

  if (!actionSummary || !riskClass) {
    return null;
  }

  return {
    actionSummary,
    beforeState,
    afterState,
    estimatedImpact:
      typeof preview.estimatedImpact === "string" ? preview.estimatedImpact.trim() || null : null,
    warnings,
    riskClass,
  };
}

function truncatePreview(text: string | null | undefined, maxLength = 120) {
  const normalized = (text || "").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function normalizeQuestionText(message: string): string {
  return normalizeAgentQuestionText(message);
}

function buildThreadTitle(message: string) {
  const normalized = message.trim();
  if (normalized.length <= 60) {
    return normalized;
  }

  return `${normalized.slice(0, 57).trim()}...`;
}

function isConfirmMessage(message: string) {
  const text = message.trim().toLowerCase();
  return (
    text === "yes" ||
    text === "y" ||
    text === "confirm" ||
    text === "apply" ||
    text === "apply it" ||
    text === "do it" ||
    text === "do that" ||
    text === "confirm it" ||
    text === "execute"
  );
}

function isCancelMessage(message: string) {
  const text = message.trim().toLowerCase();
  return (
    text === "cancel" ||
    text === "reject" ||
    text === "skip it" ||
    text === "never mind" ||
    text === "dont do that" ||
    text === "don't do that"
  );
}

async function getThreadRow(userId: string, threadId: string) {
  const [thread] = await db
    .select()
    .from(userAgentThreads)
    .where(and(eq(userAgentThreads.userId, userId), eq(userAgentThreads.id, threadId)))
    .limit(1);

  return thread;
}

export async function updateAgentThreadMetadata(input: {
  userId: string;
  threadId: string;
  workspace?: AgentThreadWorkspace;
  strategyId?: string | null;
  title?: string | null;
}) {
  const thread = await getThreadRow(input.userId, input.threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }

  const [updated] = await db
    .update(userAgentThreads)
    .set({
      title: input.title === undefined ? thread.title : input.title,
      metadata: buildThreadMetadata({
        existing: thread.metadata,
        workspace: input.workspace,
        strategyId: input.strategyId,
      }),
      updatedAt: new Date(),
    })
    .where(eq(userAgentThreads.id, input.threadId))
    .returning();

  return updated;
}

async function getStrategyContextForThread(userId: string, threadId: string) {
  const thread = await getThreadRow(userId, threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }

  if (getThreadWorkspace(thread.metadata) !== "strategy") {
    return {
      conversationMode: "general_chat" as const,
      strategyContext: null,
    };
  }

  const strategyId = getThreadStrategyId(thread.metadata);
  if (!strategyId) {
    return {
      conversationMode: "strategy_builder" as const,
      strategyContext: null,
    };
  }

  const [strategy] = await db
    .select()
    .from(userAgentStrategies)
    .where(and(eq(userAgentStrategies.userId, userId), eq(userAgentStrategies.id, strategyId)))
    .limit(1);

  if (!strategy) {
    return {
      conversationMode: "strategy_builder" as const,
      strategyContext: null,
    };
  }

  return {
    conversationMode:
      strategy.status === "draft"
        ? ("strategy_builder" as const)
        : ("strategy_refinement" as const),
    strategyContext: {
      strategyId: strategy.id,
      sourceThreadId: strategy.sourceThreadId || null,
      status:
        strategy.status === "draft" ||
        strategy.status === "live" ||
        strategy.status === "paused" ||
        strategy.status === "blocked" ||
        strategy.status === "archived"
          ? strategy.status
          : null,
      mandate: strategy.mandateText,
      normalizedRuleSheet: toRecord(strategy.normalizedRuleSheet),
      guardrails: toRecord(strategy.guardrails),
      reviewState: (() => {
        const normalizedRuleSheet = toRecord(strategy.normalizedRuleSheet);
        const reviewState = toRecord(normalizedRuleSheet.reviewState);
        const reviewedAt =
          typeof reviewState.reviewedAt === "string" && reviewState.reviewedAt.trim().length > 0
            ? reviewState.reviewedAt
            : null;
        const lastMaterialUpdateAt =
          typeof reviewState.lastMaterialUpdateAt === "string" &&
          reviewState.lastMaterialUpdateAt.trim().length > 0
            ? reviewState.lastMaterialUpdateAt
            : null;

        return {
          status: reviewState.status === "approved" ? "approved" : "pending",
          reviewedAt,
          lastMaterialUpdateAt,
          summary:
            typeof reviewState.summary === "string" && reviewState.summary.trim().length > 0
              ? reviewState.summary
              : null,
        } as const;
      })(),
    },
  };
}

async function getLatestPendingBundleRow(userId: string, threadId: string) {
  const [bundle] = await db
    .select()
    .from(userAgentActionBundles)
    .where(
      and(
        eq(userAgentActionBundles.userId, userId),
        eq(userAgentActionBundles.threadId, threadId),
        eq(userAgentActionBundles.status, "pending_confirmation"),
      ),
    )
    .orderBy(desc(userAgentActionBundles.createdAt))
    .limit(1);

  return bundle;
}

async function getLatestActiveBundleRow(userId: string, threadId: string) {
  const [bundle] = await db
    .select()
    .from(userAgentActionBundles)
    .where(
      and(
        eq(userAgentActionBundles.userId, userId),
        eq(userAgentActionBundles.threadId, threadId),
        inArray(userAgentActionBundles.status, ["pending_confirmation", "pending_clarification"]),
      ),
    )
    .orderBy(desc(userAgentActionBundles.createdAt))
    .limit(1);

  return bundle;
}

async function getLatestPendingClarification(userId: string, threadId: string) {
  const activeBundle = await getLatestActiveBundleRow(userId, threadId);
  const bundleClarification = activeBundle
    ? getBundlePendingClarification(activeBundle.actionPayload)
    : null;
  if (bundleClarification) {
    return bundleClarification;
  }

  const [row] = await db
    .select({
      structuredPayload: userAgentMessages.structuredPayload,
    })
    .from(userAgentMessages)
    .where(
      and(
        eq(userAgentMessages.userId, userId),
        eq(userAgentMessages.threadId, threadId),
        eq(userAgentMessages.role, "assistant"),
      ),
    )
    .orderBy(desc(userAgentMessages.createdAt))
    .limit(1);

  return row ? extractPendingClarification(row.structuredPayload) : null;
}

async function touchThread(threadId: string, timestamp = new Date()) {
  await db
    .update(userAgentThreads)
    .set({
      lastMessageAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(userAgentThreads.id, threadId));
}

async function createThreadMessage(input: {
  threadId: string;
  userId: string;
  role: AgentThreadMessage["role"];
  messageType: AgentThreadMessage["messageType"];
  contentText: string;
  runId?: string | null;
  actionBundleId?: string | null;
  structuredPayload?: unknown;
}) {
  const [message] = await db
    .insert(userAgentMessages)
    .values({
      threadId: input.threadId,
      userId: input.userId,
      role: input.role,
      messageType: input.messageType,
      contentText: input.contentText,
      runId: input.runId || null,
      actionBundleId: input.actionBundleId || null,
      structuredPayload: input.structuredPayload ?? null,
    })
    .returning();

  await touchThread(input.threadId, message.createdAt);
  return message;
}

function mapMessageRowToView(input: {
  row: typeof userAgentMessages.$inferSelect;
  actionBundle: typeof userAgentActionBundles.$inferSelect | null;
}): AgentThreadMessage {
  return {
    id: input.row.id,
    role: input.row.role as AgentThreadMessage["role"],
    messageType: input.row.messageType as AgentThreadMessage["messageType"],
    contentText: input.row.contentText,
    createdAt: input.row.createdAt,
    runId: input.row.runId || null,
    citations: extractCitations(input.row.structuredPayload),
    pendingClarification: extractPendingClarification(input.row.structuredPayload),
    toolTrace: extractToolTrace(input.row.structuredPayload),
    skillsUsed: extractStringListField(input.row.structuredPayload, "skillsUsed"),
    memoryInfluences: extractStringListField(input.row.structuredPayload, "memoryInfluences"),
    confirmationPreview: extractConfirmationPreview(input.row.structuredPayload),
    uiBlocks: extractUiBlocks(input.row.structuredPayload),
    generatedBy:
      input.row.role === "user"
        ? "user"
        : extractGeneratedBy(input.row.structuredPayload) ||
          (input.row.role === "assistant" ? "assistant" : null),
    scheduleJobType: extractScheduleJobType(input.row.structuredPayload),
    actionBundle: input.actionBundle ? mapActionBundleRowToView(input.actionBundle) : null,
  };
}

async function expirePendingBundles(userId: string, threadId: string) {
  const rows = await db
    .select({
      id: userAgentActionBundles.id,
      runId: userAgentActionBundles.runId,
    })
    .from(userAgentActionBundles)
    .where(
      and(
        eq(userAgentActionBundles.userId, userId),
        eq(userAgentActionBundles.threadId, threadId),
        inArray(userAgentActionBundles.status, ["pending_confirmation", "pending_clarification"]),
      ),
    );

  if (rows.length === 0) {
    return;
  }

  await db
    .update(userAgentActionBundles)
    .set({
      status: "expired",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userAgentActionBundles.userId, userId),
        eq(userAgentActionBundles.threadId, threadId),
        inArray(userAgentActionBundles.status, ["pending_confirmation", "pending_clarification"]),
      ),
    );

  const runIds = rows.map((row) => row.runId).filter((runId): runId is string => Boolean(runId));
  if (runIds.length === 0) {
    return;
  }

  await db
    .update(userAgentProposals)
    .set({
      status: "expired",
      errorMessage: null,
    })
    .where(
      and(
        eq(userAgentProposals.userId, userId),
        inArray(userAgentProposals.runId, runIds),
        eq(userAgentProposals.status, "proposed"),
      ),
    );
}

async function getThreadSummariesFromRows(
  userId: string,
  rows: Array<typeof userAgentThreads.$inferSelect>,
): Promise<AgentThreadSummary[]> {
  if (rows.length === 0) {
    return [];
  }

  const threadIds = rows.map((row) => row.id);
  const [messageRows, pendingBundleRows] = await Promise.all([
    db
      .select({
        id: userAgentMessages.id,
        threadId: userAgentMessages.threadId,
        contentText: userAgentMessages.contentText,
        createdAt: userAgentMessages.createdAt,
      })
      .from(userAgentMessages)
      .where(
        and(eq(userAgentMessages.userId, userId), inArray(userAgentMessages.threadId, threadIds)),
      )
      .orderBy(desc(userAgentMessages.createdAt)),
    db
      .select()
      .from(userAgentActionBundles)
      .where(
        and(
          eq(userAgentActionBundles.userId, userId),
          inArray(userAgentActionBundles.threadId, threadIds),
          inArray(userAgentActionBundles.status, ["pending_confirmation", "pending_clarification"]),
        ),
      )
      .orderBy(desc(userAgentActionBundles.createdAt)),
  ]);

  const latestMessageByThread = new Map<string, (typeof messageRows)[number]>();
  for (const message of messageRows) {
    if (!latestMessageByThread.has(message.threadId)) {
      latestMessageByThread.set(message.threadId, message);
    }
  }

  const pendingBundleByThread = new Map<string, typeof userAgentActionBundles.$inferSelect>();
  for (const bundle of pendingBundleRows) {
    if (!pendingBundleByThread.has(bundle.threadId)) {
      pendingBundleByThread.set(bundle.threadId, bundle);
    }
  }

  return rows.map((row) => {
    const latestMessage = latestMessageByThread.get(row.id);
    const pendingBundle = pendingBundleByThread.get(row.id);

    return {
      id: row.id,
      title: row.title,
      channel: row.channel as AgentChannel,
      domain: row.domain as AgentDomain,
      workspace: getThreadWorkspace(row.metadata),
      strategyId: getThreadStrategyId(row.metadata),
      status: row.status,
      lastMessageAt: row.lastMessageAt,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      lastMessagePreview: truncatePreview(latestMessage?.contentText),
      pendingActionBundle: pendingBundle ? mapActionBundleRowToView(pendingBundle) : null,
    };
  });
}

async function getRecentConversationHistory(userId: string, threadId: string) {
  const rows = await db
    .select({
      role: userAgentMessages.role,
      contentText: userAgentMessages.contentText,
    })
    .from(userAgentMessages)
    .where(
      and(
        eq(userAgentMessages.userId, userId),
        eq(userAgentMessages.threadId, threadId),
        inArray(userAgentMessages.role, ["user", "assistant"]),
      ),
    )
    .orderBy(desc(userAgentMessages.createdAt))
    .limit(6);

  return rows.reverse().map((row) => ({
    role: row.role as "user" | "assistant",
    contentText: row.contentText,
  }));
}

async function getActionBundleRow(userId: string, actionBundleId: string) {
  const [row] = await db
    .select()
    .from(userAgentActionBundles)
    .where(
      and(eq(userAgentActionBundles.userId, userId), eq(userAgentActionBundles.id, actionBundleId)),
    )
    .limit(1);

  return row;
}

async function getThreadActionBundleById(
  userId: string,
  threadId: string,
  actionBundleId: string,
  allowedStatuses: Array<"pending_confirmation" | "pending_clarification">,
) {
  const bundle = await getActionBundleRow(userId, actionBundleId);
  const bundleStatus = bundle?.status;
  const isAllowedStatus =
    typeof bundleStatus === "string" &&
    allowedStatuses.some((allowedStatus) => allowedStatus === bundleStatus);
  if (!bundle || bundle.threadId !== threadId || !isAllowedStatus) {
    return null;
  }

  return bundle;
}

async function applyPendingBundle(
  userId: string,
  threadId: string,
  pendingBundleId?: string | null,
) {
  const bundle = pendingBundleId
    ? await getThreadActionBundleById(userId, threadId, pendingBundleId, ["pending_confirmation"])
    : await getLatestPendingBundleRow(userId, threadId);
  if (!bundle) {
    throw new Error("No pending plan remains on this thread");
  }

  const actions = Array.isArray(bundle.actionPayload)
    ? sanitizeAgentActions(bundle.actionPayload)
    : getBundleActions(bundle.actionPayload);
  const isScoutOnlyBundle =
    actions.length > 0 && actions.every((action) => action.actionType === "scout_set_count");

  if (actions.length === 0) {
    throw new Error("Pending plan does not contain any executable actions");
  }

  try {
    if (isScoutOnlyBundle) {
      if (bundle.runId) {
        await approvePortfolioAgentRun(userId, bundle.runId);
      } else {
        await executeAgentActions(userId, actions);
      }
    } else {
      await executeAgentActions(userId, actions);
    }

    await db
      .update(userAgentActionBundles)
      .set({
        status: "applied",
        confirmedAt: new Date(),
        appliedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userAgentActionBundles.id, bundle.id));

    const updatedBundle = await getActionBundleRow(userId, bundle.id);
    const assistantMessage = await createThreadMessage({
      threadId,
      userId,
      role: "assistant",
      messageType: "result",
      contentText: `Applied the pending plan. ${bundle.summary}`,
      runId: bundle.runId,
      actionBundleId: bundle.id,
      structuredPayload: {
        status: "applied",
      },
    });

    return {
      assistantMessage,
      bundle: updatedBundle ? mapActionBundleRowToView(updatedBundle) : null,
    };
  } catch (error: any) {
    await db
      .update(userAgentActionBundles)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(userAgentActionBundles.id, bundle.id));

    const assistantMessage = await createThreadMessage({
      threadId,
      userId,
      role: "assistant",
      messageType: "error",
      contentText: error?.message || "Failed to apply the pending plan.",
      runId: bundle.runId,
      actionBundleId: bundle.id,
      structuredPayload: {
        status: "failed",
      },
    });

    throw Object.assign(new Error(error?.message || "Failed to apply pending plan"), {
      assistantMessage,
    });
  }
}

async function cancelPendingBundle(
  userId: string,
  threadId: string,
  pendingBundleId?: string | null,
) {
  const bundle = pendingBundleId
    ? await getThreadActionBundleById(userId, threadId, pendingBundleId, [
        "pending_confirmation",
        "pending_clarification",
      ])
    : await getLatestActiveBundleRow(userId, threadId);
  if (!bundle) {
    throw new Error("No pending plan remains on this thread");
  }

  const actions = Array.isArray(bundle.actionPayload)
    ? sanitizeAgentActions(bundle.actionPayload)
    : getBundleActions(bundle.actionPayload);
  const isScoutOnlyBundle =
    actions.length > 0 && actions.every((action) => action.actionType === "scout_set_count");

  if (bundle.runId) {
    if (isScoutOnlyBundle) {
      await rejectPortfolioAgentRun(userId, bundle.runId);
    } else {
      await markAgentRunRejected(userId, bundle.runId);
    }
  }

  await db
    .update(userAgentActionBundles)
    .set({
      status: "rejected",
      updatedAt: new Date(),
    })
    .where(eq(userAgentActionBundles.id, bundle.id));

  const updatedBundle = await getActionBundleRow(userId, bundle.id);
  const assistantMessage = await createThreadMessage({
    threadId,
    userId,
    role: "assistant",
    messageType: "result",
    contentText:
      "Dismissed the pending plan. Send a new request whenever you want a different move.",
    runId: bundle.runId,
    actionBundleId: bundle.id,
    structuredPayload: {
      status: "rejected",
    },
  });

  return {
    assistantMessage,
    bundle: updatedBundle ? mapActionBundleRowToView(updatedBundle) : null,
  };
}

export async function createAgentThread(
  userId: string,
  input: unknown = {},
): Promise<AgentThreadSummary> {
  const data = createThreadInputSchema.parse(input);

  const [thread] = await db
    .insert(userAgentThreads)
    .values({
      userId,
      channel: data.channel || "in_app",
      domain: data.domain || "sportfolio",
      status: "active",
      title: data.title || null,
      metadata: buildThreadMetadata({
        workspace: data.workspace || "chat",
        strategyId: data.strategyId,
      }),
    })
    .returning();

  const [summary] = await getThreadSummariesFromRows(userId, [thread]);
  return summary;
}

export async function stageAgentThreadBundle(input: {
  userId: string;
  threadId?: string | null;
  channel?: AgentChannel;
  domain?: AgentDomain;
  title?: string | null;
  requestMessage?: string | null;
  summary: string;
  replyText?: string | null;
  warnings?: string[];
  actions: AgentAction[];
  pendingClarification?: AgentPendingClarification | null;
}): Promise<AgentThreadTurnResult> {
  const existingThreadId = input.threadId?.trim() || "";
  const threadSummary =
    existingThreadId !== ""
      ? await getAgentThread(input.userId, existingThreadId)
      : await createAgentThread(input.userId, {
          channel: input.channel || "cli",
          domain: input.domain || "sportfolio",
          title: input.title?.trim() || undefined,
        });

  const threadId = threadSummary.id;
  const requestMessage = input.requestMessage?.trim() || "";
  const normalizedWarnings = Array.isArray(input.warnings)
    ? input.warnings.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const pendingClarification = input.pendingClarification || null;

  await expirePendingBundles(input.userId, threadId);

  let userMessage: AgentThreadMessage | null = null;
  if (requestMessage) {
    const createdUserMessage = await createThreadMessage({
      threadId,
      userId: input.userId,
      role: "user",
      messageType: "chat",
      contentText: requestMessage,
    });
    userMessage = {
      id: createdUserMessage.id,
      role: "user",
      messageType: "chat",
      contentText: createdUserMessage.contentText,
      createdAt: createdUserMessage.createdAt,
      runId: null,
      actionBundle: null,
      citations: [],
      pendingClarification: null,
    };
  }

  const [bundleRow] = await db
    .insert(userAgentActionBundles)
    .values({
      threadId,
      userId: input.userId,
      domain: input.domain || "sportfolio",
      runId: null,
      status: pendingClarification ? "pending_clarification" : "pending_confirmation",
      summary: input.summary || "Pending plan",
      warnings: normalizedWarnings,
      actionPayload: buildWorkflowPayload({
        summary: input.summary,
        actions: input.actions,
        pendingClarification,
      }),
    })
    .returning();

  const bundleView = mapActionBundleRowToView(bundleRow);
  const assistantMessage = await createThreadMessage({
    threadId,
    userId: input.userId,
    role: "assistant",
    messageType: "plan",
    contentText: input.replyText?.trim() || input.summary || "Pending plan staged.",
    actionBundleId: bundleRow.id,
    structuredPayload: {
      summary: input.summary,
      warnings: normalizedWarnings,
      actions: input.actions,
      citations: [],
      proposedMemoryWrites: [],
      toolTrace: [],
      status: "completed",
      pendingClarification,
    },
  });

  return {
    thread: await getAgentThread(input.userId, threadId),
    createdMessages: [
      ...(userMessage ? [userMessage] : []),
      {
        id: assistantMessage.id,
        role: "assistant",
        messageType: "plan",
        contentText: assistantMessage.contentText,
        createdAt: assistantMessage.createdAt,
        runId: assistantMessage.runId,
        actionBundle: bundleView,
        citations: [],
        pendingClarification,
      },
    ],
    pendingActionBundle: bundleView,
    pendingClarification,
  };
}

export async function getOrCreateSmsAgentThread(
  userId: string,
  externalThreadKey: string,
): Promise<AgentThreadSummary> {
  const normalizedExternalThreadKey = externalThreadKey.trim();

  const [existingThread] = await db
    .select()
    .from(userAgentThreads)
    .where(
      and(
        eq(userAgentThreads.userId, userId),
        eq(userAgentThreads.channel, "sms"),
        eq(userAgentThreads.status, "active"),
        eq(userAgentThreads.externalThreadKey, normalizedExternalThreadKey),
      ),
    )
    .orderBy(desc(userAgentThreads.updatedAt))
    .limit(1);

  if (existingThread) {
    const [summary] = await getThreadSummariesFromRows(userId, [existingThread]);
    return summary;
  }

  const [thread] = await db
    .insert(userAgentThreads)
    .values({
      userId,
      channel: "sms",
      domain: "sportfolio",
      status: "active",
      title: "SMS Agent",
      externalThreadKey: normalizedExternalThreadKey,
    })
    .returning();

  const [summary] = await getThreadSummariesFromRows(userId, [thread]);
  return summary;
}

export async function listAgentThreads(
  userId: string,
  input: { workspace?: AgentThreadWorkspace } = {},
): Promise<AgentThreadSummary[]> {
  const rows = await db
    .select()
    .from(userAgentThreads)
    .where(eq(userAgentThreads.userId, userId))
    .orderBy(desc(userAgentThreads.updatedAt))
    .limit(50);

  const summaries = await getThreadSummariesFromRows(userId, rows);
  return input.workspace
    ? summaries.filter((thread) => thread.workspace === input.workspace)
    : summaries;
}

export async function getAgentQuestionLogs(): Promise<AgentQuestionLogReport> {
  try {
    await backfillRecentAgentMessageEmbeddings();
  } catch (error: any) {
    console.warn(
      "[Agent Embeddings] Could not backfill recent question embeddings:",
      error?.message || error,
    );
  }

  let rows: Array<{
    userId: string;
    threadId: string;
    contentText: string;
    createdAt: Date;
    semanticRouteHint: string | null;
    embedding: number[] | null;
  }>;

  try {
    rows = await db
      .select({
        userId: userAgentMessages.userId,
        threadId: userAgentMessages.threadId,
        contentText: userAgentMessages.contentText,
        createdAt: userAgentMessages.createdAt,
        semanticRouteHint: userAgentMessageEmbeddings.semanticRouteHint,
        embedding: userAgentMessageEmbeddings.embedding,
      })
      .from(userAgentMessages)
      .leftJoin(
        userAgentMessageEmbeddings,
        eq(userAgentMessageEmbeddings.messageId, userAgentMessages.id),
      )
      .where(and(eq(userAgentMessages.role, "user"), eq(userAgentMessages.messageType, "chat")))
      .orderBy(desc(userAgentMessages.createdAt))
      .limit(500);
  } catch (error: any) {
    console.warn(
      "[Agent Embeddings] Could not query question embeddings:",
      error?.message || error,
    );
    const fallbackRows = await db
      .select({
        userId: userAgentMessages.userId,
        threadId: userAgentMessages.threadId,
        contentText: userAgentMessages.contentText,
        createdAt: userAgentMessages.createdAt,
      })
      .from(userAgentMessages)
      .where(and(eq(userAgentMessages.role, "user"), eq(userAgentMessages.messageType, "chat")))
      .orderBy(desc(userAgentMessages.createdAt))
      .limit(500);

    rows = fallbackRows.map((row) => ({
      ...row,
      semanticRouteHint: null,
      embedding: null,
    }));
  }

  const recentQuestions = rows.slice(0, 100).map((row) => ({
    userId: row.userId,
    threadId: row.threadId,
    message: row.contentText,
    createdAt: row.createdAt,
    semanticRouteHint:
      (row.semanticRouteHint as AgentQuestionLogReport["recentQuestions"][number]["semanticRouteHint"]) ||
      null,
  }));

  const commonPromptMap = new Map<
    string,
    {
      normalizedPrompt: string;
      samplePrompt: string;
      count: number;
      lastAskedAt: Date;
    }
  >();

  for (const row of rows) {
    const normalizedPrompt = normalizeQuestionText(row.contentText);
    if (!normalizedPrompt) {
      continue;
    }

    const existing = commonPromptMap.get(normalizedPrompt);
    if (!existing) {
      commonPromptMap.set(normalizedPrompt, {
        normalizedPrompt,
        samplePrompt: row.contentText.trim(),
        count: 1,
        lastAskedAt: row.createdAt,
      });
      continue;
    }

    existing.count += 1;
    if (row.createdAt > existing.lastAskedAt) {
      existing.lastAskedAt = row.createdAt;
      existing.samplePrompt = row.contentText.trim();
    }
  }

  const commonQuestions = [...commonPromptMap.values()]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return right.lastAskedAt.getTime() - left.lastAskedAt.getTime();
    })
    .slice(0, 50);

  const routeCounts = buildAgentQuestionRouteCounts(
    rows.map((row) => ({
      message: row.contentText,
      createdAt: row.createdAt,
      semanticRouteHint:
        (row.semanticRouteHint as (typeof recentQuestions)[number]["semanticRouteHint"]) || null,
    })),
  );
  const semanticClusters = buildAgentQuestionSemanticClusters(
    rows
      .filter((row) => Array.isArray(row.embedding) && row.embedding.length > 0)
      .map((row) => ({
        normalizedText: normalizeQuestionText(row.contentText),
        message: row.contentText.trim(),
        createdAt: row.createdAt,
        route:
          (row.semanticRouteHint as (typeof recentQuestions)[number]["semanticRouteHint"]) || null,
        embedding: row.embedding as number[],
      })),
  );

  return {
    recentQuestions,
    commonQuestions,
    routeCounts,
    semanticClusters,
  };
}

export async function getAgentThread(
  userId: string,
  threadId: string,
): Promise<AgentThreadSummary> {
  const thread = await getThreadRow(userId, threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }

  const [summary] = await getThreadSummariesFromRows(userId, [thread]);
  return summary;
}

export async function listAgentThreadMessages(
  userId: string,
  threadId: string,
): Promise<AgentThreadMessage[]> {
  const thread = await getThreadRow(userId, threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }

  const rows = await db
    .select()
    .from(userAgentMessages)
    .where(and(eq(userAgentMessages.userId, userId), eq(userAgentMessages.threadId, threadId)))
    .orderBy(asc(userAgentMessages.createdAt));

  const bundleIds = rows
    .map((row) => row.actionBundleId)
    .filter((bundleId): bundleId is string => Boolean(bundleId));
  const bundleRows =
    bundleIds.length > 0
      ? await db
          .select()
          .from(userAgentActionBundles)
          .where(
            and(
              eq(userAgentActionBundles.userId, userId),
              inArray(userAgentActionBundles.id, bundleIds),
            ),
          )
      : [];
  const bundleMap = new Map(bundleRows.map((row) => [row.id, row]));

  return rows.map((row) =>
    mapMessageRowToView({
      row,
      actionBundle: row.actionBundleId ? bundleMap.get(row.actionBundleId) || null : null,
    }),
  );
}

export async function listAgentThreadResearchSources(
  userId: string,
  threadId: string,
): Promise<AgentCitation[]> {
  const messages = await listAgentThreadMessages(userId, threadId);
  const byUrl = new Map<string, AgentCitation>();

  for (const message of messages) {
    for (const citation of message.citations || []) {
      if (!byUrl.has(citation.url)) {
        byUrl.set(citation.url, citation);
      }
    }
  }

  return [...byUrl.values()];
}

export async function sendAgentThreadMessage(
  userId: string,
  threadId: string,
  input: unknown,
): Promise<AgentThreadTurnResult> {
  const data = threadMessageInputSchema.parse(input);
  const thread = await getThreadRow(userId, threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }

  const messageText = data.message.trim();
  const pendingBundle = await getLatestPendingBundleRow(userId, threadId);
  const activeBundle = pendingBundle || (await getLatestActiveBundleRow(userId, threadId));

  if (pendingBundle && isConfirmMessage(messageText)) {
    const userMessage = await createThreadMessage({
      threadId,
      userId,
      role: "user",
      messageType: "confirmation",
      contentText: messageText,
    });
    const result = await applyPendingBundle(userId, threadId);

    return {
      thread: await getAgentThread(userId, threadId),
      createdMessages: [
        {
          id: userMessage.id,
          role: "user",
          messageType: "confirmation",
          contentText: userMessage.contentText,
          createdAt: userMessage.createdAt,
          runId: null,
          actionBundle: null,
          citations: [],
          pendingClarification: null,
        },
        {
          id: result.assistantMessage.id,
          role: "assistant",
          messageType: "result",
          contentText: result.assistantMessage.contentText,
          createdAt: result.assistantMessage.createdAt,
          runId: result.assistantMessage.runId,
          actionBundle: result.bundle,
          citations: extractCitations(result.assistantMessage.structuredPayload),
          pendingClarification: null,
        },
      ],
      pendingActionBundle: null,
      pendingClarification: null,
    };
  }

  if (activeBundle && isCancelMessage(messageText)) {
    const userMessage = await createThreadMessage({
      threadId,
      userId,
      role: "user",
      messageType: "confirmation",
      contentText: messageText,
    });
    const result = await cancelPendingBundle(userId, threadId);

    return {
      thread: await getAgentThread(userId, threadId),
      createdMessages: [
        {
          id: userMessage.id,
          role: "user",
          messageType: "confirmation",
          contentText: userMessage.contentText,
          createdAt: userMessage.createdAt,
          runId: null,
          actionBundle: null,
          citations: [],
          pendingClarification: null,
        },
        {
          id: result.assistantMessage.id,
          role: "assistant",
          messageType: "result",
          contentText: result.assistantMessage.contentText,
          createdAt: result.assistantMessage.createdAt,
          runId: result.assistantMessage.runId,
          actionBundle: result.bundle,
          citations: extractCitations(result.assistantMessage.structuredPayload),
          pendingClarification: null,
        },
      ],
      pendingActionBundle: null,
      pendingClarification: null,
    };
  }

  const pendingClarification = pendingBundle
    ? null
    : await getLatestPendingClarification(userId, threadId);
  const shouldResumeClarification = shouldTreatAsClarificationReply(
    pendingClarification,
    messageText,
  );
  const effectiveMessage =
    shouldResumeClarification && pendingClarification
      ? hydrateClarificationMessage(pendingClarification, messageText) || messageText
      : messageText;
  const conversationHistory = await getRecentConversationHistory(userId, threadId);
  const threadStrategyContext = await getStrategyContextForThread(userId, threadId);
  await ensureDefaultUserAgentSchedules(userId);
  const userMessage = await createThreadMessage({
    threadId,
    userId,
    role: "user",
    messageType: "chat",
    contentText: messageText,
  });
  let semanticRouteMatch: Awaited<ReturnType<typeof recordAgentMessageEmbedding>> | null = null;
  if (!shouldResumeClarification) {
    try {
      semanticRouteMatch = await recordAgentMessageEmbedding({
        messageId: userMessage.id,
        userId,
        threadId,
        role: "user",
        messageType: "chat",
        contentText: messageText,
      });
    } catch (error: any) {
      console.warn(
        "[Agent Embeddings] Could not record question embedding:",
        error?.message || error,
      );
    }
  }

  if (!thread.title) {
    await db
      .update(userAgentThreads)
      .set({
        title: buildThreadTitle(messageText),
        updatedAt: new Date(),
      })
      .where(eq(userAgentThreads.id, threadId));
  }

  await expirePendingBundles(userId, threadId);

  const analysis = await analyzePortfolioAgent(userId, {
    message: effectiveMessage,
    threadId,
    conversationHistory,
    semanticRouteHint: semanticRouteMatch?.route || undefined,
    conversationMode: threadStrategyContext.conversationMode,
    strategyContext: threadStrategyContext.strategyContext,
  });

  let bundleView: AgentActionBundleView | null = null;
  let actionBundleId: string | null = null;
  if (
    analysis.status === "completed" &&
    (analysis.actions.length > 0 || analysis.pendingClarification)
  ) {
    const [bundleRow] = await db
      .insert(userAgentActionBundles)
      .values({
        threadId,
        userId,
        domain: analysis.domain,
        runId: analysis.runId,
        status: analysis.pendingClarification ? "pending_clarification" : "pending_confirmation",
        summary: analysis.summary || "Pending plan",
        warnings: analysis.warnings,
        actionPayload: buildWorkflowPayload({
          summary: analysis.summary,
          actions: analysis.actions,
          pendingClarification: analysis.pendingClarification || null,
        }),
      })
      .returning();

    bundleView = mapActionBundleRowToView(bundleRow);
    actionBundleId = bundleRow.id;
  }

  const assistantMessageText =
    analysis.replyText ||
    analysis.summary ||
    analysis.errorMessage ||
    "I couldn't complete that request.";
  const assistantMessageType: AgentThreadMessage["messageType"] =
    analysis.status !== "completed" ? "error" : bundleView ? "plan" : "chat";

  const assistantMessage = await createThreadMessage({
    threadId,
    userId,
    role: "assistant",
    messageType: assistantMessageType,
    contentText: assistantMessageText,
    runId: analysis.runId,
    actionBundleId,
    structuredPayload: {
      summary: analysis.summary,
      warnings: analysis.warnings,
      actions: analysis.actions,
      citations: analysis.citations || [],
      proposedMemoryWrites: analysis.proposedMemoryWrites || [],
      toolTrace: analysis.toolTrace || [],
      skillsUsed: analysis.skillsUsed || [],
      memoryInfluences: analysis.memoryInfluences || [],
      confirmationPreview: analysis.confirmationPreview || null,
      uiBlocks: analysis.uiBlocks || [],
      generatedBy: "assistant",
      status: analysis.status,
      pendingClarification: analysis.pendingClarification || null,
    },
  });

  return {
    thread: await getAgentThread(userId, threadId),
    createdMessages: [
      {
        id: userMessage.id,
        role: "user",
        messageType: "chat",
        contentText: userMessage.contentText,
        createdAt: userMessage.createdAt,
        runId: null,
        actionBundle: null,
        citations: [],
        pendingClarification: null,
      },
      {
        id: assistantMessage.id,
        role: "assistant",
        messageType: assistantMessageType,
        contentText: assistantMessage.contentText,
        createdAt: assistantMessage.createdAt,
        runId: assistantMessage.runId,
        actionBundle: bundleView,
        citations: analysis.citations || [],
        pendingClarification: analysis.pendingClarification || null,
      },
    ],
    pendingActionBundle: bundleView,
    pendingClarification: analysis.pendingClarification || null,
  };
}

export async function confirmAgentThread(
  userId: string,
  threadId: string,
  pendingBundleId?: string | null,
): Promise<AgentThreadTurnResult> {
  const thread = await getThreadRow(userId, threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }

  const result = await applyPendingBundle(userId, threadId, pendingBundleId);

  return {
    thread: await getAgentThread(userId, threadId),
    createdMessages: [
      {
        id: result.assistantMessage.id,
        role: "assistant",
        messageType: "result",
        contentText: result.assistantMessage.contentText,
        createdAt: result.assistantMessage.createdAt,
        runId: result.assistantMessage.runId,
        actionBundle: result.bundle,
        citations: extractCitations(result.assistantMessage.structuredPayload),
        pendingClarification: null,
      },
    ],
    pendingActionBundle: null,
    pendingClarification: null,
  };
}

export async function cancelAgentThread(
  userId: string,
  threadId: string,
  pendingBundleId?: string | null,
): Promise<AgentThreadTurnResult> {
  const thread = await getThreadRow(userId, threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }

  const result = await cancelPendingBundle(userId, threadId, pendingBundleId);

  return {
    thread: await getAgentThread(userId, threadId),
    createdMessages: [
      {
        id: result.assistantMessage.id,
        role: "assistant",
        messageType: "result",
        contentText: result.assistantMessage.contentText,
        createdAt: result.assistantMessage.createdAt,
        runId: result.assistantMessage.runId,
        actionBundle: result.bundle,
        citations: extractCitations(result.assistantMessage.structuredPayload),
        pendingClarification: null,
      },
    ],
    pendingActionBundle: null,
    pendingClarification: null,
  };
}
