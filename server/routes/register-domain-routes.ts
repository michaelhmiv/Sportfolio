import type { Express } from "express";
import { registerAmmRoutes } from "./amm";
import { registerCliRoutes } from "./cli";
import { registerDocsRoutes } from "./docs";
import { registerInternalAgentToolRoutes } from "./internal-agent-tools";
import { registerLpRoutes } from "./lp";
import { registerSmsRoutes } from "./sms";

/**
 * Registers secondary route modules so `server/routes.ts` can stay focused on
 * primary app/API endpoints.
 */
export function registerDomainRoutes(app: Express) {
  registerAmmRoutes(app);
  registerLpRoutes(app);
  registerDocsRoutes(app);
  registerCliRoutes(app);
  registerSmsRoutes(app);
  registerInternalAgentToolRoutes(app);
}
