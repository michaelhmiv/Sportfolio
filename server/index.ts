import "dotenv/config";
import "./observability/otel";
import express, { type Request, Response, NextFunction } from "express";
import {
  initSentry,
  setSentryRequestContext,
  setupSentryExpressErrorHandler,
} from "./observability/sentry";
import { requestIdMiddleware } from "./observability/request-id";
import {
  getMetricsContentType,
  getMetricsText,
  metricsEnabled,
  metricsMiddleware,
} from "./observability/metrics";
import { registerRoutes } from "./routes";
import { registerHermesSidecarRoutes } from "./hermes-sidecar";
import { isHermesSidecarMode } from "./service-role";
import { setupVite, serveStatic, log } from "./vite";
import { jobScheduler } from "./jobs/scheduler.js";
import { db } from "./db";
import { botProfiles } from "@shared/schema";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { nanoid } from "nanoid";
import { normalizeSiteUrl } from "@shared/seo";

const serverStartTime = Date.now();
let serverReady = false;

function startupLog(stage: string, message: string) {
  const elapsed = Date.now() - serverStartTime;
  logger.info({ stage, elapsedMs: elapsed }, message);
}

function registerGlobalErrorHandlers(app: express.Express) {
  setupSentryExpressErrorHandler(app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    try {
      if (res.headersSent) return next(err);

      res.status(status).json({ message });
    } finally {
      console.error("[Express Error]", err);
    }
  });
}

startupLog("INIT", "Server starting...");

const app = express();
const hermesSidecarMode = isHermesSidecarMode();

initSentry();

app.use(requestIdMiddleware);
app.use(metricsMiddleware);

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === "/api/health",
    },
    genReqId: (req) => req.requestId ?? nanoid(),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  }),
);

const canonicalSiteUrlRaw = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
let canonicalSiteUrl: string | undefined;
let canonicalHost: string | undefined;

if (canonicalSiteUrlRaw?.trim()) {
  const normalizedCanonicalSiteUrl = normalizeSiteUrl(canonicalSiteUrlRaw);
  try {
    const parsedCanonicalUrl = new URL(normalizedCanonicalSiteUrl);
    canonicalSiteUrl = normalizeSiteUrl(parsedCanonicalUrl.toString());
    canonicalHost = parsedCanonicalUrl.host.toLowerCase();
  } catch {
    logger.warn(
      { publicSiteUrl: canonicalSiteUrlRaw },
      "Ignoring malformed PUBLIC_SITE_URL/SITE_URL; canonical host redirect disabled",
    );
  }
}
const enforceCanonicalHost =
  app.get("env") === "production" &&
  canonicalHost &&
  process.env.ENFORCE_CANONICAL_HOST_REDIRECT !== "false" &&
  !hermesSidecarMode;

if (enforceCanonicalHost && canonicalSiteUrl && canonicalHost) {
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    if (req.path === "/api/health" || req.path === "/api/metrics") {
      return next();
    }

    const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = (forwardedHost || req.get("host") || "").toLowerCase();
    const normalizedRequestHost = requestHost.replace(/:443$|:80$/, "");

    if (!normalizedRequestHost || normalizedRequestHost === canonicalHost) {
      return next();
    }

    const redirectTarget = `${canonicalSiteUrl}${req.originalUrl || req.url || "/"}`;
    return res.redirect(301, redirectTarget);
  });
}

// Avoid API endpoint indexing while still permitting crawler access as needed.
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/public/")) {
    return next();
  }
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

// Health check endpoint - always available, even during startup
app.get("/api/health", (_req, res) => {
  const uptime = Date.now() - serverStartTime;
  res.json({
    status: serverReady ? "ready" : "starting",
    uptime,
    uptimeSeconds: Math.floor(uptime / 1000),
    timestamp: new Date().toISOString(),
    requestId: _req.requestId,
  });
});

app.get("/api/metrics", async (_req, res) => {
  if (!metricsEnabled) return res.status(404).json({ message: "Metrics disabled" });

  const token = process.env.METRICS_TOKEN;
  if (app.get("env") === "production" && token) {
    const provided = _req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (provided !== token) return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    res.setHeader("Content-Type", getMetricsContentType());
    res.send(await getMetricsText());
  } catch (err: any) {
    res.status(500).json({ message: err?.message ?? "Failed to collect metrics" });
  }
});

if (app.get("env") !== "production") {
  app.get("/api/debug-sentry", (_req, _res) => {
    throw new Error("Sentry debug route hit");
  });
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  if (req.requestId) setSentryRequestContext(req.requestId);

  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  if (hermesSidecarMode) {
    startupLog("HERMES", "Starting Hermes sidecar mode");
    registerHermesSidecarRoutes(app);
    registerGlobalErrorHandlers(app);

    const port = parseInt(process.env.PORT || "5000", 10);
    startupLog("LISTEN", `Starting Hermes sidecar on port ${port}...`);

    const server = app.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        serverReady = true;
        startupLog("READY", `Hermes sidecar listening on port ${port}`);
        log(`hermes sidecar listening on port ${port}`);
      },
    );

    return;
  }

  startupLog("ROUTES", "Registering routes...");
  const server = await registerRoutes(app);
  startupLog("ROUTES", "Routes registered");

  registerGlobalErrorHandlers(app);

  // Keep unknown API paths from falling through to the SPA index shell.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    startupLog("VITE", "Setting up Vite dev server...");
    await setupVite(app, server);
    startupLog("VITE", "Vite dev server ready");
  } else {
    startupLog("STATIC", "Setting up static file serving");
    serveStatic(app);
    startupLog("STATIC", "Static file serving ready");
  }

  // Bind to the platform-provided PORT (Railway, etc); default to 5000 for local runs.
  // This single HTTP server handles both API endpoints and client assets.
  const port = parseInt(process.env.PORT || "5000", 10);
  startupLog("LISTEN", `Starting server on port ${port}...`);
  server.listen(
    {
      port,
      host: "0.0.0.0",
    },
    async () => {
      startupLog("LISTEN", `Server listening on port ${port}`);
      log(`serving on port ${port}`);

      // Startup migration: Ensure all bot profiles have unlimited daily limits
      try {
        await db.update(botProfiles).set({
          maxDailyOrders: 999999,
          maxDailyVolume: 999999,
        });
        log("Bot profiles updated with unlimited daily limits");
      } catch (error: any) {
        console.error("Failed to update bot profiles:", error.message);
      }

      // Always initialize contest jobs (database-only, no API required)
      try {
        await jobScheduler.initializeContestJobs();
        jobScheduler.start();
        log("Contest jobs initialized and started");
      } catch (error: any) {
        console.error("Failed to initialize contest jobs:", error.message);
      }

      // Initialize sports API-dependent jobs if the Ball Don't Lie key is available
      if (process.env.BALLDONTLIE_API_KEY) {
        try {
          await jobScheduler.initializeApiJobs();
          log("API-dependent jobs initialized and started");
        } catch (error: any) {
          console.error("Failed to initialize API jobs:", error.message);
        }
      } else {
        log("Skipping API-dependent jobs - BALLDONTLIE_API_KEY not set");
        log("Contest jobs will still process data from the database when available");
      }

      // Mark server as fully ready
      serverReady = true;
      startupLog("READY", "Server fully initialized and ready to serve requests");
    },
  );
})();
