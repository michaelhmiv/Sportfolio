import type { Express, Request, Response } from "express";
import { requireHermesInternalRequest } from "../agent/internal-auth";
import { runHermesMemoryTool, runHermesPlanTool, runHermesReadTool } from "../agent/hermes-tools";

function handleInternalToolError(res: Response, error: unknown, fallbackMessage: string) {
  console.error("[Hermes Tools] Route error:", error);
  res.status(500).json({
    message: fallbackMessage,
    ...(process.env.NODE_ENV !== "production"
      ? {
          error: error instanceof Error ? error.message : String(error),
        }
      : {}),
  });
}

function getBodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export function registerInternalAgentToolRoutes(app: Express): void {
  app.post(
    "/internal/agent-tools/read",
    requireHermesInternalRequest,
    async (req: Request, res: Response) => {
      try {
        const body = getBodyObject(req.body);
        const toolName = typeof body.toolName === "string" ? body.toolName.trim() : "";
        const userId = typeof body.userId === "string" ? body.userId.trim() : "";
        const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";

        if (!toolName || !userId) {
          res.status(400).json({ message: "toolName and userId are required" });
          return;
        }

        res.json({
          ok: true,
          result: await runHermesReadTool({
            toolName,
            userId,
            threadId: threadId || null,
            args: getBodyObject(body.args),
          }),
        });
      } catch (error) {
        handleInternalToolError(res, error, "Could not run Hermes read tool");
      }
    },
  );

  app.post(
    "/internal/agent-tools/plan",
    requireHermesInternalRequest,
    async (req: Request, res: Response) => {
      try {
        const body = getBodyObject(req.body);
        const toolName = typeof body.toolName === "string" ? body.toolName.trim() : "";
        const userId = typeof body.userId === "string" ? body.userId.trim() : "";

        if (!toolName || !userId) {
          res.status(400).json({ message: "toolName and userId are required" });
          return;
        }

        res.json({
          ok: true,
          result: await runHermesPlanTool({
            toolName,
            userId,
            args: getBodyObject(body.args),
          }),
        });
      } catch (error) {
        handleInternalToolError(res, error, "Could not run Hermes planning tool");
      }
    },
  );

  app.post(
    "/internal/agent-tools/memory",
    requireHermesInternalRequest,
    async (req: Request, res: Response) => {
      try {
        const body = getBodyObject(req.body);
        const toolName = typeof body.toolName === "string" ? body.toolName.trim() : "";
        const userId = typeof body.userId === "string" ? body.userId.trim() : "";
        const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";

        if (!toolName || !userId) {
          res.status(400).json({ message: "toolName and userId are required" });
          return;
        }

        res.json({
          ok: true,
          result: await runHermesMemoryTool({
            toolName,
            userId,
            threadId: threadId || null,
            args: getBodyObject(body.args),
          }),
        });
      } catch (error) {
        handleInternalToolError(res, error, "Could not run Hermes memory tool");
      }
    },
  );
}
