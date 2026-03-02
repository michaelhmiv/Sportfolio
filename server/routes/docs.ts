import type { Express, Request, Response } from "express";
import { optionalAuth } from "../supabaseAuth";
import { getDocsArticle, listDocsArticles, searchDocsArticles } from "../docs-service";

function isLoggedIn(req: Request): boolean {
  return Boolean(req.user?.claims?.sub);
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
}
