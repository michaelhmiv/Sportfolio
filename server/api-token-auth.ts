import { createHmac, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db";
import { storage } from "./storage";
import { sql } from "drizzle-orm";

const TOKEN_NAMESPACE = "spt";
const TOKEN_PATTERN = /^spt_[a-f0-9]{12}_[a-f0-9]{48}$/i;

function getTokenSecret(): string {
  const configuredSecret = process.env.USER_API_TOKEN_SECRET?.trim() || "";

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("USER_API_TOKEN_SECRET must be configured for API token auth in production");
  }

  return "development-only-api-token-secret";
}

function extractBearerToken(req: Request): string | null {
  const authorization = req.header("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function createDevUser() {
  return {
    claims: {
      sub: "dev-user-12345678",
      email: "dev@example.com",
      first_name: "Dev",
      last_name: "User",
    },
  };
}

async function ensureDevUser(): Promise<void> {
  const userId = "dev-user-12345678";
  const existingUser = await storage.getUser(userId);
  if (existingUser) {
    return;
  }

  await storage.upsertUser({
    id: userId,
    email: "dev@example.com",
    firstName: "Dev",
    lastName: "User",
    username: "dev_user",
  });
}

export function hashUserApiToken(token: string): string {
  return createHmac("sha256", getTokenSecret()).update(token).digest("hex");
}

export function createUserApiTokenMaterial(): {
  plaintextToken: string;
  tokenHash: string;
  tokenPrefix: string;
  tokenLast4: string;
} {
  const publicPart = randomBytes(6).toString("hex");
  const secretPart = randomBytes(24).toString("hex");
  const plaintextToken = `${TOKEN_NAMESPACE}_${publicPart}_${secretPart}`;

  return {
    plaintextToken,
    tokenHash: hashUserApiToken(plaintextToken),
    tokenPrefix: `${TOKEN_NAMESPACE}_${publicPart}`,
    tokenLast4: plaintextToken.slice(-4),
  };
}

export async function requireUserApiToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const isDev = process.env.NODE_ENV === "development";
  const bypassAuth = process.env.DEV_BYPASS_AUTH !== "false";
  const token = extractBearerToken(req);

  if (!token && isDev && bypassAuth) {
    req.user = createDevUser();
    try {
      await ensureDevUser();
    } catch (error: any) {
      console.error("[API_TOKEN_AUTH] Failed to ensure dev user:", error?.message || error);
    }
    next();
    return;
  }

  if (!token || !TOKEN_PATTERN.test(token)) {
    res.status(401).json({ message: "A valid Sportfolio API token is required" });
    return;
  }

  const storedToken = await storage.getUserApiTokenByHash(hashUserApiToken(token));

  if (!storedToken) {
    res.status(401).json({ message: "Invalid or revoked Sportfolio API token" });
    return;
  }

  await storage.markUserApiTokenUsed(storedToken.id);
  req.user = {
    claims: {
      sub: storedToken.userId,
    },
  };

  next();
}

export async function ensureUserApiTokenSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_api_tokens (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE cascade,
        label text NOT NULL,
        token_hash text NOT NULL,
        token_prefix varchar(32) NOT NULL,
        token_last4 varchar(4) NOT NULL,
        last_used_at timestamp,
        revoked_at timestamp,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS user_api_tokens_hash_idx
      ON user_api_tokens (token_hash);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_api_tokens_user_idx
      ON user_api_tokens (user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_api_tokens_active_idx
      ON user_api_tokens (user_id, revoked_at);
    `);
  } catch (error: any) {
    console.warn(
      "[API_TOKEN_AUTH] Could not ensure user_api_tokens schema:",
      error?.message || error,
    );
  }
}
