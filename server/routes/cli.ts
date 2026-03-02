import type { Express, Request, Response } from "express";
import {
  cancelAgentThread,
  confirmAgentThread,
  createAgentThread,
  listAgentThreads,
  sendAgentThreadMessage,
} from "../agent/thread-service";
import { getAgentCapabilities } from "../agent/service";
import { createUserApiTokenMaterial, requireUserApiToken } from "../api-token-auth";
import type { UserApiToken } from "@shared/schema";
import { isAuthenticated } from "../supabaseAuth";
import { storage } from "../storage";

const MAX_ACTIVE_API_TOKENS = 8;

function getUserId(req: Request): string {
  return req.user?.claims?.sub || "";
}

function toTokenView(token: UserApiToken) {
  return {
    id: token.id,
    label: token.label,
    preview: `${token.tokenPrefix}...${token.tokenLast4}`,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  };
}

function handleCliRouteError(res: Response, error: unknown, fallbackMessage: string) {
  console.error("[CLI] Route error:", error);
  const errorDetail =
    process.env.NODE_ENV !== "production"
      ? error instanceof Error
        ? error.message
        : String(error)
      : undefined;

  res.status(500).json({
    message: fallbackMessage,
    ...(errorDetail ? { error: errorDetail } : {}),
  });
}

async function stageCliAgentMessage(input: {
  userId: string;
  message: string;
  threadId?: string;
  title?: string;
}) {
  const existingThreadId = input.threadId?.trim() || "";
  const title = input.title?.trim() || "";
  const thread =
    existingThreadId !== ""
      ? { id: existingThreadId }
      : await createAgentThread(input.userId, {
          channel: "in_app",
          ...(title ? { title } : {}),
        });

  const result = await sendAgentThreadMessage(input.userId, thread.id, { message: input.message });

  return {
    threadId: thread.id,
    createdThread: existingThreadId === "",
    result,
  };
}

function buildCliActionMessage(body: any): string | null {
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const player = typeof body?.player === "string" ? body.player.trim() : "";
  const dollars = Number(body?.dollars);
  const shares = Number(body?.shares);

  if (action === "buy") {
    if (!player || !Number.isFinite(dollars) || dollars <= 0) {
      return null;
    }
    return `buy $${dollars} of ${player}`;
  }

  if (action === "sell") {
    if (!player || !Number.isFinite(shares) || shares <= 0) {
      return null;
    }
    return `sell ${shares} shares of ${player}`;
  }

  if (action === "watchlist_add") {
    if (!player) {
      return null;
    }
    return `add ${player} to my watchlist`;
  }

  if (action === "watchlist_remove") {
    if (!player) {
      return null;
    }
    return `remove ${player} from my watchlist`;
  }

  if (action === "vesting_claim") {
    return "claim my vesting shares";
  }

  if (action === "community_boost") {
    if (!player) {
      return null;
    }
    const timing =
      typeof body?.timing === "string" && body.timing.trim() ? body.timing.trim() : "today";
    return `create a community boost for ${player} ${timing}`;
  }

  return null;
}

export function registerCliRoutes(app: Express): void {
  app.get("/api/account/tokens", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const tokens = await storage.listUserApiTokens(getUserId(req));
      res.json({
        tokens: tokens.map(toTokenView),
        maxActiveTokens: MAX_ACTIVE_API_TOKENS,
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not load API tokens");
    }
  });

  app.post("/api/account/tokens", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
      if (!label || label.length > 80) {
        res.status(400).json({ message: "Token label must be between 1 and 80 characters" });
        return;
      }

      const userId = getUserId(req);
      const existingTokens = await storage.listUserApiTokens(userId);
      const activeTokenCount = existingTokens.filter((token) => !token.revokedAt).length;
      if (activeTokenCount >= MAX_ACTIVE_API_TOKENS) {
        res.status(400).json({
          message: `You can only keep ${MAX_ACTIVE_API_TOKENS} active API tokens at once`,
        });
        return;
      }

      const tokenMaterial = createUserApiTokenMaterial();
      const createdToken = await storage.createUserApiToken({
        userId,
        label,
        tokenHash: tokenMaterial.tokenHash,
        tokenPrefix: tokenMaterial.tokenPrefix,
        tokenLast4: tokenMaterial.tokenLast4,
      });

      res.status(201).json({
        token: {
          ...toTokenView(createdToken),
          plaintextToken: tokenMaterial.plaintextToken,
        },
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not create API token");
    }
  });

  app.delete("/api/account/tokens/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const revoked = await storage.revokeUserApiToken(getUserId(req), req.params.id);
      if (!revoked) {
        res.status(404).json({ message: "Token not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      handleCliRouteError(res, error, "Could not revoke API token");
    }
  });

  app.get("/api/cli/bootstrap", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
        capabilities: await getAgentCapabilities(userId),
        docs: {
          indexUrl: "/api/docs/index",
          searchUrl: "/api/docs/search",
        },
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not load CLI bootstrap data");
    }
  });

  app.get("/api/cli/whoami", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(getUserId(req));
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          balance: user.balance,
          isPremium: user.isPremium,
        },
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not load user profile");
    }
  });

  app.get(
    "/api/cli/portfolio/summary",
    requireUserApiToken,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const user = await storage.getUser(userId);

        if (!user) {
          res.status(404).json({ message: "User not found" });
          return;
        }

        const holdings = await storage.getUserHoldingsWithPlayers(userId);
        const vesting = await storage.getVesting(userId);
        const playerHoldings = holdings.filter(
          (entry: any) => entry.holding.assetType === "player",
        );
        const topHoldings = playerHoldings
          .map((entry: any) => ({
            playerId: entry.holding.assetId,
            playerName: entry.player
              ? `${entry.player.firstName} ${entry.player.lastName}`.trim()
              : entry.holding.assetId,
            quantity: entry.holding.quantity,
            powerLevel: entry.holding.powerLevel,
            lockedQuantity: Number(entry.totalLocked || 0),
          }))
          .sort((left, right) => Number(right.powerLevel || 0) - Number(left.powerLevel || 0))
          .slice(0, 5);

        res.json({
          summary: {
            balance: user.balance,
            holdingCount: playerHoldings.length,
            topHoldings,
            vesting: vesting
              ? {
                  sharesAccumulated: vesting.sharesAccumulated,
                  lastAccruedAt: vesting.lastAccruedAt,
                }
              : null,
          },
        });
      } catch (error) {
        handleCliRouteError(res, error, "Could not load portfolio summary");
      }
    },
  );

  app.get("/api/cli/agent/threads", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      res.json({
        threads: await listAgentThreads(getUserId(req)),
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not load agent threads");
    }
  });

  app.post("/api/cli/agent/ask", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

      if (!message) {
        res.status(400).json({ message: "Message is required" });
        return;
      }

      res.json(
        await stageCliAgentMessage({
          userId,
          message,
          threadId: typeof req.body?.threadId === "string" ? req.body.threadId : undefined,
          title: typeof req.body?.title === "string" ? req.body.title : undefined,
        }),
      );
    } catch (error) {
      handleCliRouteError(res, error, "Could not send agent message");
    }
  });

  app.post("/api/cli/actions/stage", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      const message = buildCliActionMessage(req.body);
      if (!message) {
        res.status(400).json({ message: "Invalid CLI action payload" });
        return;
      }

      res.json(
        await stageCliAgentMessage({
          userId: getUserId(req),
          message,
          threadId: typeof req.body?.threadId === "string" ? req.body.threadId : undefined,
          title: typeof req.body?.title === "string" ? req.body.title : undefined,
        }),
      );
    } catch (error) {
      handleCliRouteError(res, error, "Could not stage CLI action");
    }
  });

  app.post(
    "/api/cli/agent/threads/:threadId/confirm",
    requireUserApiToken,
    async (req: Request, res: Response) => {
      try {
        res.json(await confirmAgentThread(getUserId(req), req.params.threadId));
      } catch (error) {
        handleCliRouteError(res, error, "Could not confirm agent action bundle");
      }
    },
  );

  app.post(
    "/api/cli/agent/threads/:threadId/cancel",
    requireUserApiToken,
    async (req: Request, res: Response) => {
      try {
        res.json(await cancelAgentThread(getUserId(req), req.params.threadId));
      } catch (error) {
        handleCliRouteError(res, error, "Could not cancel agent action bundle");
      }
    },
  );
}
