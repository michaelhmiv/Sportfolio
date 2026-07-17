import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "../supabaseAuth";
import { CollectionDomainError } from "./state-engine";
import type { CollectionReadService } from "./read-service";

export interface CollectionMutationService {
  setAllocation(input: {
    userId: string;
    slug: string;
    slotId: string;
    quantity: string;
  }): Promise<unknown>;
  releaseAllocation(input: { userId: string; slug: string; slotId: string }): Promise<unknown>;
  completeCollection(input: { userId: string; slug: string }): Promise<unknown>;
}

const allocationBodySchema = z
  .object({
    quantity: z.string().min(1).max(32),
  })
  .strict();

const pathValueSchema = z.string().trim().min(1).max(200);

function getUserId(req: Request): string {
  const userId = (req.user as { claims?: { sub?: string } } | undefined)?.claims?.sub;
  if (!userId) {
    throw new CollectionDomainError("AUTHENTICATION_REQUIRED", "Authentication is required", 401);
  }
  return userId;
}

function sendCollectionError(res: Response, error: unknown): void {
  if (error instanceof CollectionDomainError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: "Collection request was invalid",
        details: { issues: error.issues },
      },
    });
    return;
  }

  console.error("[Collections API] Mutation failed", error);
  res.status(500).json({
    error: {
      code: "COLLECTION_WRITE_FAILED",
      message: "Collection request could not be completed",
    },
  });
}

export function registerCollectionRoutes(
  app: Express,
  service: CollectionMutationService,
  readService?: CollectionReadService,
): void {
  // ── read endpoints ────────────────────────────────────────────────────────
  if (readService) {
    app.get("/api/me/collections", isAuthenticated, async (req, res) => {
      try {
        const collections = await readService.listCollections(getUserId(req));
        res.json({ data: collections });
      } catch (error) {
        sendCollectionError(res, error);
      }
    });

    app.get("/api/me/collections/:slug", isAuthenticated, async (req, res) => {
      try {
        const detail = await readService.getCollectionBySlug(
          getUserId(req),
          pathValueSchema.parse(req.params.slug),
        );
        res.json({ data: detail });
      } catch (error) {
        sendCollectionError(res, error);
      }
    });
  }

  // ── mutation endpoints ────────────────────────────────────────────────────
  app.put(
    "/api/me/collections/:slug/slots/:slotId/allocation",
    isAuthenticated,
    async (req, res) => {
      try {
        const slug = pathValueSchema.parse(req.params.slug);
        const slotId = pathValueSchema.parse(req.params.slotId);
        const body = allocationBodySchema.parse(req.body);
        const result = await service.setAllocation({
          userId: getUserId(req),
          slug,
          slotId,
          quantity: body.quantity,
        });
        res.json({ data: result });
      } catch (error) {
        sendCollectionError(res, error);
      }
    },
  );

  app.delete(
    "/api/me/collections/:slug/slots/:slotId/allocation",
    isAuthenticated,
    async (req, res) => {
      try {
        const result = await service.releaseAllocation({
          userId: getUserId(req),
          slug: pathValueSchema.parse(req.params.slug),
          slotId: pathValueSchema.parse(req.params.slotId),
        });
        res.json({ data: result });
      } catch (error) {
        sendCollectionError(res, error);
      }
    },
  );

  app.post("/api/me/collections/:slug/complete", isAuthenticated, async (req, res) => {
    try {
      const result = await service.completeCollection({
        userId: getUserId(req),
        slug: pathValueSchema.parse(req.params.slug),
      });
      res.json({ data: result });
    } catch (error) {
      sendCollectionError(res, error);
    }
  });
}
