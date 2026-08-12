import type { Express, Request, Response } from "express";
import { z } from "zod";
import { optionalAuth } from "../auth/runtime-auth";
import {
  blockUserProfile,
  getUserProfileBlockStatus,
  isProfileBlockedForViewer,
  profileReportReasons,
  reportUserProfile,
  unblockUserProfile,
} from "./profile-safety";
import type { PublicProfileService, TrophyCaseEditorService } from "./profile-service";

function getViewerUserId(req: Request): string | null {
  return (req as any).user?.claims?.sub ?? null;
}

function getRequiredUserId(req: Request): string {
  const userId = getViewerUserId(req);
  if (!userId) {
    const error: any = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }
  return userId;
}

const trophyCaseBodySchema = z
  .object({
    profileVisibility: z.enum(["public", "private"]),
    badgeDefinitionIds: z.array(z.string().min(1).max(128)).max(5),
    featuredDefinitionIds: z.array(z.string().min(1).max(128)).max(4),
  })
  .strict();

const usernameSchema = z.string().trim().min(1).max(30);
const profileSafetyTargetSchema = z.object({ username: usernameSchema }).strict();
const profileReportBodySchema = z
  .object({
    username: usernameSchema,
    reason: z.enum(profileReportReasons),
    details: z.string().trim().max(1500).optional(),
  })
  .strict();
const pathValueSchema = z.string().trim().min(1).max(200);

function sendError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: "Request was invalid",
        details: { issues: error.issues },
      },
    });
    return;
  }

  const e = error as any;

  if (e?.statusCode === 404) {
    res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    return;
  }

  if (e?.statusCode === 401) {
    res
      .status(401)
      .json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    return;
  }

  if (e?.statusCode === 400) {
    res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: e.message || "Request was invalid",
      },
    });
    return;
  }

  if (e?.statusCode === 422 && Array.isArray(e?.errors)) {
    res.status(422).json({
      error: {
        code: "VALIDATION_FAILED",
        message: e.message,
        details: { errors: e.errors },
      },
    });
    return;
  }

  console.error("[Profile API] Error:", e?.message ?? error);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}

export function registerProfileRoutes(
  app: Express,
  profileService: PublicProfileService,
  editorService: TrophyCaseEditorService,
): void {
  // ── public profile ──────────────────────────────────────────────────────
  // REPLACES the old monolithic handler in server/routes.ts.
  app.get("/api/user/:userId/profile", optionalAuth, async (req, res) => {
    try {
      const requestedUserId = pathValueSchema.parse(req.params.userId);
      const viewerUserId = getViewerUserId(req);

      if (await isProfileBlockedForViewer(viewerUserId, requestedUserId)) {
        return res.status(404).json({
          error: { code: "PROFILE_BLOCKED", message: "This profile is blocked." },
        });
      }

      const profile = await profileService.getPublicProfile(requestedUserId, viewerUserId);
      res.json(profile);
    } catch (error) {
      sendError(res, error);
    }
  });

  // ── profile safety / UGC controls (authenticated) ──────────────────────
  app.post("/api/profile-safety/report", optionalAuth, async (req, res) => {
    try {
      const reporterUserId = getRequiredUserId(req);
      const body = profileReportBodySchema.parse(req.body);
      const result = await reportUserProfile({ reporterUserId, ...body });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/profile-safety/block", optionalAuth, async (req, res) => {
    try {
      const blockerUserId = getRequiredUserId(req);
      const body = profileSafetyTargetSchema.parse(req.body);
      const result = await blockUserProfile({ blockerUserId, username: body.username });
      res.json({ success: true, blocked: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/profile-safety/block", optionalAuth, async (req, res) => {
    try {
      const blockerUserId = getRequiredUserId(req);
      const body = profileSafetyTargetSchema.parse(req.body);
      const result = await unblockUserProfile({ blockerUserId, username: body.username });
      res.json({ success: true, blocked: false, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/profile-safety/block-status", optionalAuth, async (req, res) => {
    try {
      const blockerUserId = getRequiredUserId(req);
      const username = usernameSchema.parse(req.query.username);
      const result = await getUserProfileBlockStatus({ blockerUserId, username });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // ── editor endpoints (authenticated) ────────────────────────────────────
  app.get("/api/me/trophy-case", optionalAuth, async (req, res) => {
    try {
      const userId = getRequiredUserId(req);
      const state = await editorService.getEditorState(userId);
      res.json(state);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put("/api/me/trophy-case", optionalAuth, async (req, res) => {
    try {
      const userId = getRequiredUserId(req);
      const body = trophyCaseBodySchema.parse(req.body);
      const state = await editorService.updateTrophyCase(userId, body);
      res.json(state);
    } catch (error) {
      sendError(res, error);
    }
  });
}
