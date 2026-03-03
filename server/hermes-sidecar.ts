import type { Express, Request, Response } from "express";
import { z } from "zod";
import { loadScoutAgentContext } from "./agent/context-loader";
import { runHermesOrchestrationTurn } from "./agent/hermes-orchestrator";
import { requireHermesInternalRequest } from "./agent/internal-auth";
import { getScoutAgentRuntimeProfile } from "./agent/service";
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
      try {
        const parsed = hermesSidecarRequestSchema.parse(req.body);
        const user = await storage.getUser(parsed.userId);

        if (!user) {
          res.status(404).json({ message: "User not found" });
          return;
        }

        const { profile, secret } = await getScoutAgentRuntimeProfile(parsed.userId);
        const context = await loadScoutAgentContext(parsed.userId, profile, {
          chatRequest: parsed.message,
        });

        const result = await runHermesOrchestrationTurn({
          userId: parsed.userId,
          profile,
          secret,
          context,
          request: {
            userId: parsed.userId,
            threadId: parsed.canonicalState.threadId,
            channel: parsed.channel,
            message: parsed.message,
            requestMode: parsed.requestMode as HermesRespondRequest["requestMode"],
            orchestrationMode: parsed.orchestrationMode || "hermes_first",
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
            profile: {
              displayName: profile.displayName,
              providerMode: profile.providerMode as HermesRespondRequest["profile"]["providerMode"],
              model: profile.model,
              baseUrl: profile.baseUrl,
              systemPrompt: profile.systemPrompt,
              userPromptTemplate: profile.userPromptTemplate,
              temperature: Number(profile.temperature) || 0.4,
              maxTokens: profile.maxTokens,
            },
            modelRuntime: {
              providerMode:
                profile.providerMode as HermesRespondRequest["modelRuntime"]["providerMode"],
              model: profile.model,
              baseUrl: profile.baseUrl,
            },
            canonicalState: {
              threadId: parsed.canonicalState.threadId,
              pendingBundleId: parsed.canonicalState.pendingBundleId,
              operatorOverview: context.operatorOverview,
              capabilities: parsed.canonicalState
                .capabilities as unknown as HermesRespondRequest["canonicalState"]["capabilities"],
            },
            memoryContext: parsed.memoryContext as unknown as HermesRespondRequest["memoryContext"],
            externalContext: {
              canonicalKnowledge:
                parsed.externalContext.canonicalKnowledge.length > 0
                  ? (parsed.externalContext
                      .canonicalKnowledge as unknown as HermesRespondRequest["externalContext"]["canonicalKnowledge"])
                  : context.knowledgeBrief,
              research: parsed.externalContext
                .research as unknown as HermesRespondRequest["externalContext"]["research"],
            },
            conversationHistory: parsed.conversationHistory,
            semanticRouteHint: normalizeSemanticRouteHint(parsed.semanticRouteHint),
          },
        });

        res.json(result);
      } catch (error) {
        handleHermesSidecarError(res, error);
      }
    },
  );
}
