import type { Express, Request, Response } from "express";
import { z } from "zod";
import { optionalAuth } from "../supabaseAuth";
import { validateBatchRequest } from "./public-identity-service";
import type { PublicIdentityService } from "./public-identity-service";

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

  if (e?.statusCode === 400) {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: e.message },
    });
    return;
  }

  console.error("[Public Identities API] Error:", e?.message ?? error);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}

export function registerPublicIdentityRoutes(app: Express, service: PublicIdentityService): void {
  app.post("/api/public-identities/resolve", optionalAuth, async (req: Request, res: Response) => {
    try {
      const errors = validateBatchRequest(req.body);
      if (errors.length > 0) {
        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: errors[0].message,
            details: { errors },
          },
        });
        return;
      }

      const identities = await service.resolveBatch(req.body as { userIds: string[] });
      res.json({ identities });
    } catch (error) {
      sendError(res, error);
    }
  });
}
