import type { Express, Request, Response } from "express";
import { optionalAuth } from "../auth/runtime-auth";
import { answerDocsQuestion } from "../docs-qa";
import {
  getDocsArticle,
  getDocsHandbook,
  listDocsArticles,
  searchDocsArticles,
} from "../docs-service";

const DOCS_ASK_WINDOW_MS = 10 * 60 * 1000;
const DOCS_ASK_MAX_REQUESTS = 5;
const docsAskRequestsByIp = new Map<string, number[]>();

function isLoggedIn(req: Request): boolean {
  return Boolean(req.user?.claims?.sub);
}

function getRequestIp(req: Request): string {
  return req.ip || req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";
}

function isDocsAskRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - DOCS_ASK_WINDOW_MS;
  const recentRequests = (docsAskRequestsByIp.get(ip) || []).filter(
    (timestamp) => timestamp >= windowStart,
  );

  if (recentRequests.length >= DOCS_ASK_MAX_REQUESTS) {
    docsAskRequestsByIp.set(ip, recentRequests);
    return true;
  }

  recentRequests.push(now);
  docsAskRequestsByIp.set(ip, recentRequests);
  return false;
}

export function resetDocsAskRateLimiterForTests(): void {
  docsAskRequestsByIp.clear();
}

export function registerDocsRoutes(app: Express): void {
  app.get("/api/docs/index", optionalAuth, (req: Request, res: Response) => {
    try {
      res.json({
        articles: listDocsArticles(isLoggedIn(req)),
      });
    } catch (error) {
      console.error("[Docs] Could not load docs index:", error);
      res.status(500).json({ message: "Could not load docs index" });
    }
  });

  app.get("/api/docs/handbook", optionalAuth, (req: Request, res: Response) => {
    try {
      res.json({
        handbook: getDocsHandbook(isLoggedIn(req)),
      });
    } catch (error) {
      console.error("[Docs] Could not load docs handbook:", error);
      res.status(500).json({ message: "Could not load docs handbook" });
    }
  });

  app.get("/api/docs/article/:section/:slug", optionalAuth, (req: Request, res: Response) => {
    try {
      const article = getDocsArticle(req.params.section, req.params.slug, isLoggedIn(req));

      if (!article) {
        res.status(404).json({ message: "Docs article not found" });
        return;
      }

      res.json({ article });
    } catch (error) {
      console.error("[Docs] Could not load docs article:", error);
      res.status(500).json({ message: "Could not load docs article" });
    }
  });

  app.get("/api/docs/search", optionalAuth, (req: Request, res: Response) => {
    try {
      const query = typeof req.query.q === "string" ? req.query.q : "";

      res.json({
        results: searchDocsArticles(query, isLoggedIn(req)),
      });
    } catch (error) {
      console.error("[Docs] Could not search docs:", error);
      res.status(500).json({ message: "Could not search docs" });
    }
  });

  app.post("/api/docs/ask", optionalAuth, async (req: Request, res: Response) => {
    try {
      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      if (!query) {
        res.status(400).json({ message: "A docs question is required" });
        return;
      }

      const ip = getRequestIp(req);
      if (isDocsAskRateLimited(ip)) {
        res.status(429).json({ message: "Docs question rate limit reached. Try again in a bit." });
        return;
      }

      res.json(await answerDocsQuestion(query));
    } catch (error) {
      console.error("[Docs] Could not answer docs question:", error);
      res.status(500).json({ message: "Could not answer docs question" });
    }
  });
}
