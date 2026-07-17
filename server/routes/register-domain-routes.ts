import type { Express } from "express";
import { registerCollectionRoutes } from "../collections/routes";
import { registerMlbCollectionAdminRoutes } from "../collections/mlb/admin-routes";
import { mlbCatalogAdminService } from "../collections/mlb/catalog-admin-service";
import { collectionReadService, collectionService } from "../collections/runtime";
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
import { registerProfileRoutes } from "../profile/profile-routes";
import { profileService, editorService } from "../profile/runtime";
import { registerPublicIdentityRoutes } from "../public-identities/public-identity-routes";
import { publicIdentityService } from "../public-identities/runtime";

/**
 * Registers secondary route modules so `server/routes.ts` can stay focused on
 * primary app/API endpoints.
 */
export function registerDomainRoutes(app: Express): void {
  // Collection routes are split by authorization level: users mutate allocations;
  // only admins may preview, publish, or disable catalog content.
  registerCollectionRoutes(app, collectionService, collectionReadService);
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
  registerProfileRoutes(app, profileService, editorService);
  registerPublicIdentityRoutes(app, publicIdentityService);
}
