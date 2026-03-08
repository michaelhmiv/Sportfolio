import type { Express, Request, Response } from "express";
import { z } from "zod";

import { requireRedditBotToken } from "../reddit-bot-auth";
import {
  REDDIT_POST_TYPES,
  buildRedditPostPreview,
  buildRedditPreviewImageSvg,
  type SignedRedditImageInput,
  reportRedditPost,
  verifyRedditPreviewImageSignature,
} from "../reddit-market-posts";

const redditPostTypeSchema = z.enum(REDDIT_POST_TYPES);

const previewInputSchema = z
  .object({
    subreddit: z.string().trim().min(1).max(120),
    postType: redditPostTypeSchema,
    sports: z.array(z.string().trim().min(1).max(16)).max(8).optional(),
    reserve: z.boolean().optional(),
    force: z.boolean().optional(),
    marketDay: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    titleTemplate: z.string().trim().min(1).max(160).optional().nullable(),
  })
  .strict();

const reportInputSchema = z
  .object({
    subreddit: z.string().trim().min(1).max(120),
    postType: redditPostTypeSchema,
    marketDay: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    contentHash: z.string().trim().length(64),
    status: z.enum(["posted", "failed", "skipped"]),
    title: z.string().trim().max(160).optional(),
    markdown: z.string().trim().max(12000).optional(),
    redditPostId: z.string().trim().max(80).optional().nullable(),
    redditPostUrl: z.string().trim().url().max(512).optional().nullable(),
    imageUrl: z.string().trim().url().max(512).optional().nullable(),
    errorMessage: z.string().trim().max(1000).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const publicImageQuerySchema = z
  .object({
    subreddit: z.string().trim().min(1).max(120),
    postType: redditPostTypeSchema,
    sports: z.string().trim().min(1).max(160),
    marketDay: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    titleTemplate: z.string().trim().min(1).max(160).optional(),
    sig: z.string().trim().length(64),
  })
  .strict();

function handleValidationError(error: z.ZodError, res: Response) {
  res.status(400).json({
    message: "Invalid Reddit integration payload",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

export function registerRedditBotRoutes(app: Express): void {
  app.get("/api/integrations/reddit/preview-image.svg", async (req: Request, res) => {
    const parsed = publicImageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    const signedInput: SignedRedditImageInput = {
      subreddit: parsed.data.subreddit,
      postType: parsed.data.postType,
      sports: parsed.data.sports
        .split(",")
        .map((sport) => sport.trim())
        .filter(Boolean),
      marketDay: parsed.data.marketDay,
      titleTemplate: parsed.data.titleTemplate || null,
    };

    if (!verifyRedditPreviewImageSignature(signedInput, parsed.data.sig)) {
      res.status(401).json({ message: "Invalid signed image request" });
      return;
    }

    try {
      const preview = await buildRedditPostPreview({
        ...signedInput,
        force: true,
      });
      const svg = buildRedditPreviewImageSvg(preview);
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.send(svg);
    } catch (error: any) {
      console.error("[reddit/preview-image.svg] Error:", error?.message || error);
      res.status(500).json({ message: "Failed to generate Reddit preview image" });
    }
  });

  app.post("/api/integrations/reddit/preview", requireRedditBotToken, async (req: Request, res) => {
    const parsed = previewInputSchema.safeParse(req.body);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    try {
      const preview = await buildRedditPostPreview(parsed.data);
      res.json(preview);
    } catch (error: any) {
      console.error("[reddit/preview] Error:", error?.message || error);
      res.status(500).json({ message: "Failed to build Reddit post preview" });
    }
  });

  app.post(
    "/api/integrations/reddit/preview-image",
    requireRedditBotToken,
    async (req: Request, res) => {
      const parsed = previewInputSchema.safeParse(req.body);
      if (!parsed.success) {
        handleValidationError(parsed.error, res);
        return;
      }

      try {
        const preview = await buildRedditPostPreview(parsed.data);
        const svg = buildRedditPreviewImageSvg(preview);
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.send(svg);
      } catch (error: any) {
        console.error("[reddit/preview-image] Error:", error?.message || error);
        res.status(500).json({ message: "Failed to generate Reddit preview image" });
      }
    },
  );

  app.post("/api/integrations/reddit/report", requireRedditBotToken, async (req: Request, res) => {
    const parsed = reportInputSchema.safeParse(req.body);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    try {
      const row = await reportRedditPost(parsed.data);
      res.json({ history: row });
    } catch (error: any) {
      console.error("[reddit/report] Error:", error?.message || error);
      res.status(500).json({ message: "Failed to record Reddit post outcome" });
    }
  });
}
