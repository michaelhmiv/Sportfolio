import type { Express, Request, Response } from "express";
import { createUserApiTokenMaterial, requireUserApiToken } from "../api-token-auth";
import {
  buildPublicPromptRegistry,
  buildPublicResourceRegistry,
  createDefaultPublicMcpDependencies,
  executeResolvedPublicTool,
  resolvePublicCapabilityCatalog,
  executePublicTool,
  readPublicResource,
  renderPublicPrompt,
} from "../mcp/public-tool-registry";
import type { UserApiToken } from "@shared/schema";
import { isAuthenticated } from "../supabaseAuth";
import { storage } from "../storage";

const MAX_ACTIVE_API_TOKENS = 8;
const publicDeps = createDefaultPublicMcpDependencies();

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
  const statusCode = 500;
  const message = fallbackMessage;
  const errorDetail =
    process.env.NODE_ENV !== "production"
      ? error instanceof Error
        ? error.message
        : String(error)
      : undefined;

  res.status(statusCode).json({
    message,
    ...(errorDetail ? { error: errorDetail } : {}),
  });
}

function buildCliActionInvocation(
  body: any,
): { toolName: string; args: Record<string, unknown> } | null {
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const playerId =
    typeof body?.playerId === "string"
      ? body.playerId.trim()
      : typeof body?.player === "string"
        ? body.player.trim()
        : "";
  const amount = Number(body?.dollars ?? body?.amount);
  const shares = Number(body?.shares);

  if (action === "buy" && playerId && Number.isFinite(amount) && amount > 0) {
    return { toolName: "stage_market_buy", args: { playerId, amount } };
  }
  if (action === "sell" && playerId && Number.isFinite(shares) && shares > 0) {
    return { toolName: "stage_market_sell", args: { playerId, shares } };
  }
  if (action === "community_boost" && playerId) {
    return { toolName: "stage_community_boost_create", args: { playerId } };
  }
  return null;
}

function createPublicContext(userId: string) {
  return {
    userId,
    deps: publicDeps,
  };
}

type CliToolCatalogLike = {
  name: string;
  title?: string | null;
  description: string;
  domain: string;
  readOnly: boolean;
  executionModel?: string;
  confirmationModel?: string;
  requiresConfirmation?: boolean;
  riskLevel?: string | null;
  inputSchema?: Record<string, unknown>;
  inputFieldNames?: string[];
  fixtureArgs?: Record<string, unknown>;
  provider?: string | null;
  source?: string;
  routeRefs?: string[];
};

function toCliToolView(tool: CliToolCatalogLike) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    domain: tool.domain,
    readOnly: tool.readOnly,
    executionModel: tool.executionModel,
    confirmationModel: tool.confirmationModel,
    requiresConfirmation: tool.requiresConfirmation,
    riskLevel: tool.riskLevel,
    inputKeys: tool.inputFieldNames || Object.keys(tool.inputSchema || {}),
    inputFieldNames: tool.inputFieldNames || Object.keys(tool.inputSchema || {}),
    fixtureArgs: tool.fixtureArgs,
    provider: tool.provider,
    source: tool.source,
    routeRefs: tool.routeRefs || [],
  };
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
        capabilities: {
          toolCatalogUrl: "/api/cli/tools/catalog",
          stagedActions: true,
          semanticMlbTools: true,
        },
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
      const result = await executePublicTool(
        createPublicContext(getUserId(req)),
        "get_account_profile",
      );
      res.json(result);
    } catch (error) {
      handleCliRouteError(res, error, "Could not load user profile");
    }
  });

  app.get(
    "/api/cli/portfolio/summary",
    requireUserApiToken,
    async (req: Request, res: Response) => {
      try {
        const result = await executePublicTool(
          createPublicContext(getUserId(req)),
          "get_portfolio_summary",
        );
        res.json(result);
      } catch (error) {
        handleCliRouteError(res, error, "Could not load portfolio summary");
      }
    },
  );

  app.post("/api/cli/actions/stage", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      const invocation = buildCliActionInvocation(req.body);
      if (!invocation) {
        res.status(400).json({ message: "Invalid CLI action payload" });
        return;
      }
      res.json(
        await executePublicTool(
          createPublicContext(getUserId(req)),
          invocation.toolName,
          invocation.args,
        ),
      );
    } catch (error) {
      handleCliRouteError(res, error, "Could not stage CLI action");
    }
  });

  app.get("/api/cli/tools", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      const catalog = await resolvePublicCapabilityCatalog(createPublicContext(getUserId(req)));
      res.json({
        tools: catalog.tools.map(toCliToolView),
        dynamicSources: catalog.dynamicSources,
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not load public tools");
    }
  });

  app.get("/api/cli/tools/catalog", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      res.json(await resolvePublicCapabilityCatalog(createPublicContext(getUserId(req))));
    } catch (error) {
      handleCliRouteError(res, error, "Could not load public tool catalog");
    }
  });

  app.get(
    "/api/cli/tools/:name/schema",
    requireUserApiToken,
    async (req: Request, res: Response) => {
      try {
        const catalog = await resolvePublicCapabilityCatalog(createPublicContext(getUserId(req)));
        const tool = catalog.tools.find((entry) => entry.name === req.params.name);
        if (!tool) {
          res.status(404).json({ message: "Tool not found" });
          return;
        }
        res.json({ tool });
      } catch (error) {
        handleCliRouteError(res, error, "Could not load public tool schema");
      }
    },
  );

  app.post("/api/cli/tools/:name", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      res.json(
        await executeResolvedPublicTool(
          createPublicContext(getUserId(req)),
          req.params.name,
          req.body && typeof req.body === "object" ? req.body : {},
        ),
      );
    } catch (error) {
      handleCliRouteError(res, error, "Could not execute public tool");
    }
  });

  app.get("/api/cli/prompts", requireUserApiToken, async (_req: Request, res: Response) => {
    try {
      res.json({
        prompts: buildPublicPromptRegistry().map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          inputKeys: Object.keys(prompt.argsSchema || {}),
          fixtureArgs: prompt.fixtureArgs,
        })),
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not load public prompts");
    }
  });

  app.post(
    "/api/cli/prompts/:name/render",
    requireUserApiToken,
    async (req: Request, res: Response) => {
      try {
        res.json(
          await renderPublicPrompt(
            req.params.name,
            req.body && typeof req.body === "object" ? req.body : {},
          ),
        );
      } catch (error) {
        handleCliRouteError(res, error, "Could not render public prompt");
      }
    },
  );

  app.get("/api/cli/resources", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      res.json({
        resources: buildPublicResourceRegistry(createPublicContext(getUserId(req))).map(
          (resource) => ({
            id: resource.id,
            uri: resource.uri,
            mimeType: resource.mimeType,
            description: resource.description,
          }),
        ),
      });
    } catch (error) {
      handleCliRouteError(res, error, "Could not load public resources");
    }
  });

  app.get("/api/cli/resources/read", requireUserApiToken, async (req: Request, res: Response) => {
    try {
      const uri = typeof req.query.uri === "string" ? req.query.uri : "";
      if (!uri) {
        res.status(400).json({ message: "uri is required" });
        return;
      }

      res.json(await readPublicResource(createPublicContext(getUserId(req)), uri));
    } catch (error) {
      handleCliRouteError(res, error, "Could not read public resource");
    }
  });
}
