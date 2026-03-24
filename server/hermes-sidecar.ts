import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { loadPortfolioAgentContext } from "./agent/context-loader";
import { runHermesOrchestrationTurn } from "./agent/hermes-orchestrator";
import { HERMES_CORRELATION_HEADER, requireHermesInternalRequest } from "./agent/internal-auth";
import { buildHermesTurnRequest } from "./agent/runtime-adapter";
import { getPortfolioAgentRuntimeProfile } from "./agent/service";
import type { AgentSemanticRoute, HermesRespondRequest } from "./agent/types";
import { storage } from "./storage";

const hermesSidecarRequestSchema = z.object({
  userId: z.string().trim().min(1),
  channel: z.enum(["in_app", "sms", "cli"]).default("in_app"),
  message: z.string().trim().min(1),
  requestMode: z.enum(["auto", "discussion", "plan", "clarification_resume"]).default("auto"),
  orchestrationMode: z.enum(["hermes_first"]).optional(),
  toolAllowlist: z.array(z.string().trim().min(1)).default([]),
  toolCatalog: z.array(z.record(z.unknown())).default([]),
  availableSkills: z.array(z.record(z.unknown())).default([]),
  skillPolicy: z
    .object({
      allowRuntimeSkillCreation: z.boolean().default(true),
      requireAdminApprovalForGlobalSkills: z.boolean().default(true),
    })
    .default({
      allowRuntimeSkillCreation: true,
      requireAdminApprovalForGlobalSkills: true,
    }),
  memoryMode: z.enum(["off", "read_only", "read_write"]).default("read_write"),
  autoExecutionPolicy: z
    .object({
      allowAdvisoryJobs: z.boolean().default(true),
      allowRiskyActions: z.boolean().default(false),
    })
    .default({
      allowAdvisoryJobs: true,
      allowRiskyActions: false,
    }),
  confirmationPolicy: z
    .object({
      requireExplicitConfirmation: z.boolean().default(true),
      preferredChannel: z.enum(["in_app", "sms", "cli"]).default("in_app"),
    })
    .default({
      requireExplicitConfirmation: true,
      preferredChannel: "in_app",
    }),
  canonicalState: z
    .object({
      threadId: z.string().trim().min(1).nullable().default(null),
      pendingBundleId: z.string().trim().min(1).nullable().default(null),
      operatorOverview: z.record(z.unknown()).default({}),
      capabilities: z.record(z.unknown()).default({}),
    })
    .default({
      threadId: null,
      pendingBundleId: null,
      operatorOverview: {},
      capabilities: {},
    }),
  memoryContext: z
    .object({
      profile: z.array(z.record(z.unknown())).default([]),
      episodic: z.array(z.record(z.unknown())).default([]),
      semantic: z.array(z.record(z.unknown())).default([]),
    })
    .default({
      profile: [],
      episodic: [],
      semantic: [],
    }),
  externalContext: z
    .object({
      canonicalKnowledge: z.array(z.record(z.unknown())).default([]),
      research: z.array(z.record(z.unknown())).default([]),
    })
    .default({
      canonicalKnowledge: [],
      research: [],
    }),
  continuityState: z.record(z.unknown()).nullable().optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        contentText: z.string(),
      }),
    )
    .default([]),
  semanticRouteHint: z
    .enum(["top_targets_today", "single_adjustment", "review_setup", "general_scouting"])
    .nullable()
    .optional(),
  conversationMode: z
    .enum(["general_chat", "strategy_builder", "strategy_refinement", "strategy_review"])
    .nullable()
    .optional(),
  strategyContext: z
    .object({
      strategyId: z.string().trim().min(1),
      sourceThreadId: z.string().trim().min(1).nullable().default(null),
      status: z.enum(["draft", "live", "paused", "blocked", "archived"]).nullable().default(null),
      mandate: z.string().trim().min(1),
      normalizedRuleSheet: z.record(z.unknown()).default({}),
      guardrails: z.record(z.unknown()).default({}),
    })
    .nullable()
    .optional(),
  triggerContext: z
    .object({
      source: z.enum([
        "manual",
        "manual_retry",
        "schedule",
        "strategy_schedule",
        "strategy_event",
        "bot_cycle",
        "system",
      ]),
      label: z.string().trim().min(1).nullable().optional(),
      jobType: z
        .enum([
          "daily_setup_review",
          "pre_lock_nudge",
          "injury_watch",
          "idle_balance_nudge",
          "boost_window",
        ])
        .nullable()
        .optional(),
      eventType: z.string().trim().min(1).nullable().optional(),
      requestedAt: z.string().trim().min(1),
    })
    .nullable()
    .optional(),
  executionContext: z
    .object({
      kind: z.enum(["manual_thread", "scheduled_advisory", "strategy_run", "bot_runtime"]),
      allowAutoExecution: z.boolean(),
      requiresExplicitConfirmation: z.boolean(),
    })
    .nullable()
    .optional(),
});

function normalizeSemanticRouteHint(value: AgentSemanticRoute | null | undefined) {
  return value || null;
}

function handleHermesSidecarError(res: Response, error: unknown) {
  console.error("[Hermes Sidecar] Request failed:", error);
  const isValidationError = error instanceof z.ZodError;

  res.status(isValidationError ? 400 : 500).json({
    message: isValidationError ? "Invalid Hermes sidecar request" : "Hermes sidecar request failed",
    ...(process.env.NODE_ENV !== "production"
      ? {
          error: error instanceof Error ? error.message : String(error),
        }
      : {}),
  });
}

export function registerHermesSidecarRoutes(app: Express): void {
  app.post(
    "/internal/hermes/respond",
    requireHermesInternalRequest,
    async (req: Request, res: Response) => {
      const correlationId = req.header(HERMES_CORRELATION_HEADER)?.trim() || crypto.randomUUID();
      res.setHeader(HERMES_CORRELATION_HEADER, correlationId);
      try {
        const parsed = hermesSidecarRequestSchema.parse(req.body);
        const user = await storage.getUser(parsed.userId);

        if (!user) {
          res.status(404).json({ message: "User not found" });
          return;
        }

        const { profile, secret } = await getPortfolioAgentRuntimeProfile(parsed.userId);
        const context = await loadPortfolioAgentContext(parsed.userId, profile, {
          chatRequest: parsed.message,
        });

        const request = await buildHermesTurnRequest({
          userId: parsed.userId,
          threadId: parsed.canonicalState.threadId,
          channel: parsed.channel,
          message: parsed.message,
          requestMode: parsed.requestMode as HermesRespondRequest["requestMode"],
          orchestrationMode: parsed.orchestrationMode || "hermes_first",
          profile,
          secret,
          context,
          toolAllowlist: parsed.toolAllowlist,
          toolCatalog: parsed.toolCatalog as unknown as HermesRespondRequest["toolCatalog"],
          availableSkills:
            parsed.availableSkills as unknown as HermesRespondRequest["availableSkills"],
          skillPolicy: parsed.skillPolicy,
          memoryMode: parsed.memoryMode,
          autoExecutionPolicy: parsed.autoExecutionPolicy,
          confirmationPolicy: {
            requireExplicitConfirmation: parsed.confirmationPolicy.requireExplicitConfirmation,
            preferredChannel: parsed.channel,
          },
          capabilities: parsed.canonicalState
            .capabilities as unknown as HermesRespondRequest["canonicalState"]["capabilities"],
          memoryContext: parsed.memoryContext as unknown as HermesRespondRequest["memoryContext"],
          canonicalKnowledge:
            parsed.externalContext.canonicalKnowledge.length > 0
              ? (parsed.externalContext
                  .canonicalKnowledge as unknown as HermesRespondRequest["externalContext"]["canonicalKnowledge"])
              : undefined,
          externalResearch: parsed.externalContext
            .research as unknown as HermesRespondRequest["externalContext"]["research"],
          continuityState: parsed.continuityState as HermesRespondRequest["continuityState"],
          conversationHistory: parsed.conversationHistory,
          semanticRouteHint: normalizeSemanticRouteHint(parsed.semanticRouteHint),
          conversationMode: parsed.conversationMode || null,
          pendingBundleId: parsed.canonicalState.pendingBundleId,
          strategyContext: parsed.strategyContext || null,
          triggerContext: parsed.triggerContext || null,
          executionContext: parsed.executionContext || null,
        });

        const result = await runHermesOrchestrationTurn({
          userId: parsed.userId,
          profile,
          secret,
          context,
          request,
        });

        res.json(result);
      } catch (error) {
        handleHermesSidecarError(res, error);
      }
    },
  );
}
