import type { Express, Request, Response } from "express";
import { z } from "zod";
import { loadScoutAgentContext } from "./agent/context-loader";
import { requireHermesInternalRequest } from "./agent/internal-auth";
import { runLocalHermesCompatibilityTurn } from "./agent/hermes-local";
import { getScoutAgentRuntimeProfile } from "./agent/service";
import type { AgentSemanticRoute, HermesRespondRequest } from "./agent/types";
import { storage } from "./storage";

const hermesSidecarRequestSchema = z.object({
  userId: z.string().trim().min(1),
  channel: z.enum(["in_app", "sms", "cli"]).default("in_app"),
  message: z.string().trim().min(1),
  requestMode: z.enum(["auto", "discussion", "plan", "clarification_resume"]).default("auto"),
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

        const result = await runLocalHermesCompatibilityTurn({
          userId: parsed.userId,
          channel: parsed.channel,
          profile,
          secret,
          context,
          chatRequest: parsed.message,
          semanticRouteHint: normalizeSemanticRouteHint(parsed.semanticRouteHint),
          conversationHistory: parsed.conversationHistory,
          requestedMode: parsed.requestMode as HermesRespondRequest["requestMode"],
        });

        res.json(result);
      } catch (error) {
        handleHermesSidecarError(res, error);
      }
    },
  );
}
