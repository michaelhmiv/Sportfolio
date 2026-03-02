import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const INTERNAL_AUTH_HEADER = "x-hermes-internal-key";

function getConfiguredInternalKey(): string | null {
  const configured =
    process.env.HERMES_INTERNAL_KEY?.trim() || process.env.USER_AGENT_SECRET_KEY?.trim() || "";
  return configured || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildHermesInternalHeaders(): Record<string, string> {
  const key = getConfiguredInternalKey();
  if (!key) {
    throw new Error("Hermes internal auth key is not configured");
  }

  return {
    [INTERNAL_AUTH_HEADER]: key,
  };
}

export function requireHermesInternalRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getConfiguredInternalKey();
  if (!expected) {
    res.status(503).json({ message: "Hermes internal auth is not configured" });
    return;
  }

  const provided = req.header(INTERNAL_AUTH_HEADER)?.trim() || "";
  if (!provided || !constantTimeEquals(provided, expected)) {
    res.status(401).json({ message: "Invalid internal agent credentials" });
    return;
  }

  next();
}
