/**
 * Sportfolio API Routes
 * 
 * Modular route organization to replace monolithic routes.ts
 * Each module handles a specific domain:
 * - players.ts: Player listings, details, search
 * - orders.ts: Order creation, matching, history
 * - users.ts: Auth, profiles, portfolios
 * - contests.ts: Contests, entries, lineups, scoring
 * - market.ts: Market data, snapshots, analytics
 */

import { Express } from 'express';
import { setupPlayerRoutes } from './players';
import { setupOrderRoutes } from './orders';
import { setupUserRoutes } from './users';
import { setupContestRoutes } from './contests';
import { setupMarketRoutes } from './market';
import { setupSystemRoutes } from './system';

export function setupRoutes(app: Express) {
  // Health check (must be first)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Domain-specific routes
  setupPlayerRoutes(app);
  setupOrderRoutes(app);
  setupUserRoutes(app);
  setupContestRoutes(app);
  setupMarketRoutes(app);
  setupSystemRoutes(app);

  // 404 handler
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });
}
