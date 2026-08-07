import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { db } from "../../db";
import { isAuthenticated } from "../../auth/runtime-auth";
import { mlbCatalogAdminService } from "./catalog-admin-service";
import { catalogConfirmationSha256, type MlbCatalogPreview } from "./catalog-preview";

export interface MlbCollectionAdminService {
  preview(slug?: string): Promise<MlbCatalogPreview[]>;
  inspect(): Promise<unknown>;
  participation(slug: string): Promise<unknown>;
  publishInitial(actorUserId: string, expectedCatalogSha256: string): Promise<unknown>;
  refresh(slug: string, expectedSourceSha256: string): Promise<unknown>;
  finalize(slug: string, expectedSourceSha256: string): Promise<unknown>;
  correct(
    slug: string,
    actorUserId: string,
    expectedSourceSha256: string,
    correctionReason: string,
  ): Promise<unknown>;
  reconcile(limit: number): Promise<unknown>;
  disable(
    slug: string,
    reason: string,
    expectedVersion: number,
    expectedSourceSha256: string,
  ): Promise<unknown>;
}

const slugSchema = z.string().trim().min(1).max(200);
const previewQuerySchema = z.object({ slug: slugSchema.optional() }).strict();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const publishSchema = z
  .object({
    confirm: z.literal("PUBLISH_INITIAL_MLB_CATALOG"),
    catalogSha256: sha256Schema,
  })
  .strict();
const refreshSchema = z
  .object({
    confirm: z.literal("REFRESH_MLB_COLLECTION"),
    sourceSha256: sha256Schema,
  })
  .strict();
const finalizeSchema = z
  .object({
    confirm: z.literal("FINALIZE_MLB_COLLECTION"),
    sourceSha256: sha256Schema,
  })
  .strict();
const correctionSchema = z
  .object({
    confirm: z.literal("CREATE_MLB_CORRECTION_VERSION"),
    sourceSha256: sha256Schema,
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
const disableSchema = z
  .object({
    confirm: z.literal("DISABLE_COLLECTION"),
    reason: z.string().trim().min(8).max(500),
    expectedVersion: z.number().int().positive(),
    sourceSha256: sha256Schema,
  })
  .strict();
const reconcileSchema = z
  .object({
    confirm: z.literal("RECONCILE_COLLECTION_STATES"),
    limit: z.number().int().min(1).max(5000).default(500),
  })
  .strict();

function getUserId(req: Request): string {
  const userId = (req.user as { claims?: { sub?: string } } | undefined)?.claims?.sub;
  if (!userId) throw new Error("Authenticated user id is missing");
  return userId;
}

export const requireAdminUser: RequestHandler = async (req, res, next) => {
  try {
    const [user] = await db
      .select({ id: users.id, isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, getUserId(req)))
      .limit(1);
    if (!user?.isAdmin) {
      res.status(403).json({ error: { code: "ADMIN_REQUIRED", message: "Admin role required" } });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

function sendAdminError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "Invalid catalog administration request" },
    });
    return;
  }

  const message = error instanceof Error ? error.message : "";
  const operationalError = (
    [
      [
        /was not found|has no current version|Unknown MLB catalog definition/i,
        404,
        "COLLECTION_NOT_FOUND",
      ],
      [
        /source snapshot changed|stale source|current version changed|prerequisite graph no longer matches|no longer matches the confirmed preview manifest/i,
        409,
        "SOURCE_SNAPSHOT_CHANGED",
      ],
      [
        /refusing partial|does not match the confirmed persisted manifest|is not tracking|is not final|does not change the source snapshot|kind does not match|requires a player-slot|not a player-slot definition/i,
        409,
        "CATALOG_CONFLICT",
      ],
      [
        /catalog preview failed|unresolved prerequisites|failed preview/i,
        422,
        "CATALOG_VALIDATION_FAILED",
      ],
    ] as const
  ).find(([pattern]) => pattern.test(message));
  if (operationalError) {
    const [, status, code] = operationalError;
    res.status(status).json({ error: { code, message } });
    return;
  }

  console.error("[MLB Catalog Admin] operation failed", error);
  res.status(500).json({
    error: { code: "CATALOG_ADMIN_FAILED", message: "Catalog operation failed" },
  });
}

export function registerMlbCollectionAdminRoutes(
  app: Express,
  service: MlbCollectionAdminService = mlbCatalogAdminService,
  adminMiddleware: RequestHandler = requireAdminUser,
): void {
  const middleware: Array<(req: Request, res: Response, next: NextFunction) => unknown> = [
    isAuthenticated,
    adminMiddleware,
  ];

  app.get("/api/admin/collections/mlb/catalog", ...middleware, async (_req, res) => {
    try {
      res.json({ data: await service.inspect() });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.get("/api/admin/collections/mlb/catalog/preview", ...middleware, async (req, res) => {
    try {
      const { slug } = previewQuerySchema.parse(req.query);
      const previews = await service.preview(slug);
      res.json({ data: previews, catalogSha256: catalogConfirmationSha256(previews) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.get("/api/admin/collections/:slug/participation", ...middleware, async (req, res) => {
    try {
      res.json({ data: await service.participation(slugSchema.parse(req.params.slug)) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.post("/api/admin/collections/mlb/catalog/publish", ...middleware, async (req, res) => {
    try {
      const body = publishSchema.parse(req.body);
      res
        .status(201)
        .json({ data: await service.publishInitial(getUserId(req), body.catalogSha256) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.post("/api/admin/collections/:slug/refresh", ...middleware, async (req, res) => {
    try {
      const body = refreshSchema.parse(req.body);
      res.json({
        data: await service.refresh(slugSchema.parse(req.params.slug), body.sourceSha256),
      });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.post("/api/admin/collections/:slug/finalize", ...middleware, async (req, res) => {
    try {
      const body = finalizeSchema.parse(req.body);
      res.json({
        data: await service.finalize(slugSchema.parse(req.params.slug), body.sourceSha256),
      });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.post("/api/admin/collections/:slug/correct", ...middleware, async (req, res) => {
    try {
      const body = correctionSchema.parse(req.body);
      res.status(201).json({
        data: await service.correct(
          slugSchema.parse(req.params.slug),
          getUserId(req),
          body.sourceSha256,
          body.reason,
        ),
      });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.post("/api/admin/collections/reconcile", ...middleware, async (req, res) => {
    try {
      const body = reconcileSchema.parse(req.body);
      res.json({ data: await service.reconcile(body.limit) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  app.post("/api/admin/collections/:slug/disable", ...middleware, async (req, res) => {
    try {
      const body = disableSchema.parse(req.body);
      const slug = slugSchema.parse(req.params.slug);
      res.json({
        data: await service.disable(slug, body.reason, body.expectedVersion, body.sourceSha256),
      });
    } catch (error) {
      sendAdminError(res, error);
    }
  });
}
