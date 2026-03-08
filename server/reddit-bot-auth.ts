import type { NextFunction, Request, Response } from "express";

function extractBearerToken(req: Request): string | null {
  const authorization = req.header("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function getConfiguredToken(): string {
  const token = process.env.REDDIT_BOT_API_TOKEN?.trim() || "";
  if (token) {
    return token;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("REDDIT_BOT_API_TOKEN must be configured in production");
  }

  return "development-only-reddit-bot-token";
}

export function getRedditBotTokenSecret(): string {
  return getConfiguredToken();
}

export function requireRedditBotToken(req: Request, res: Response, next: NextFunction): void {
  const isDev = process.env.NODE_ENV !== "production";
  const bypassAuth = process.env.DEV_BYPASS_AUTH !== "false";
  const token = extractBearerToken(req);

  if (isDev && bypassAuth && !token) {
    next();
    return;
  }

  if (!token || token !== getConfiguredToken()) {
    res.status(401).json({ message: "A valid Reddit bot token is required" });
    return;
  }

  next();
}
