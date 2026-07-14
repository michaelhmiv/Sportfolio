import type { Express } from "express";
import { registerCollectionRoutes } from "../collections/routes";
import { registerMlbCollectionAdminRoutes } from "../collections/mlb/admin-routes";
import { mlbCatalogAdminService } from "../collections/mlb/catalog-admin-service";
import { collectionService } from "../collections/runtime";
import { registerAccountDeletionRoutes } from "./account-deletion";
import { registerAmmRoutes } from "./amm";
import { registerCliRoutes } from "./cli";
import { registerDiscordRoutes } from "./discord";
import { registerDocsRoutes } from "./docs";
import { registerInternalAgentToolRoutes } from "./internal-agent-tools";
import { registerLpRoutes } from "./lp";
import { registerMcpRoutes } from "./mcp";
import { registerNotificationRoutes } from "./notifications";
import { registerRedditBotRoutes } from "./reddit-bot";
import { registerSmsRoutes } from "./sms";

/**
 * Registers secondary route modules so `server/routes.ts` can stay focused on
 * primary app/API endpoints.
 */
export function registerDomainRoutes(app: Express): void {
  // Collection routes are split by authorization level: users mutate allocations;
  // only admins may preview, publish, or disable catalog content.
  registerCollectionRoutes(app, collectionService);
  registerMlbCollectionAdminRoutes(app, mlbCatalogAdminService);
  registerAccountDeletionRoutes(app);
  registerAmmRoutes(app);
  registerLpRoutes(app);
  registerDocsRoutes(app);
  registerCliRoutes(app);
  registerDiscordRoutes(app);
  registerSmsRoutes(app);
  registerNotificationRoutes(app);
  registerRedditBotRoutes(app);
  registerInternalAgentToolRoutes(app);
  registerMcpRoutes(app);
}
