# API Map (Agent-Oriented)

Primary sources:

- `server/routes.ts`
- `server/routes/amm.ts`
- `server/routes/lp.ts`

Upstream provider contract reference:

- `https://www.balldontlie.io/openapi.yml`

Use the OpenAPI file when:

- validating provider endpoint/field support,
- answering provider API behavior questions,
- adding support for additional sports in ingestion/sync flows.

This is a practical map of the API surface most likely to affect gameplay/economics.

## Auth Modes

- **Public**: no auth middleware.
- **optionalAuth**: works anonymously, enriches response for logged-in users.
- **isAuthenticated**: requires authenticated user (or dev bypass in local dev).
- **adminAuth**: admin-only (admin token or admin user context).

## Core Player/Portfolio Endpoints

| Method | Path                                  | Auth            | Purpose                                   |
| ------ | ------------------------------------- | --------------- | ----------------------------------------- |
| GET    | `/api/dashboard`                      | optionalAuth    | Dashboard aggregates + user-context data  |
| GET    | `/api/portfolio`                      | isAuthenticated | User holdings + portfolio metrics         |
| GET    | `/api/activity`                       | isAuthenticated | User activity feed                        |
| GET    | `/api/player/:id`                     | isAuthenticated | Player details with user-specific context |
| GET    | `/api/player/:id/stats`               | Public          | Player stats                              |
| GET    | `/api/player/:id/recent-games`        | Public          | Recent game logs                          |
| GET    | `/api/player/:id/financials`          | Public          | Market/economic player data               |
| POST   | `/api/holdings/condense`              | isAuthenticated | Consolidate share power representation    |
| GET    | `/api/holdings/:playerId/power-level` | isAuthenticated | Power-level data for a player holding     |

## Auth & User Endpoints

| Method | Path                             | Auth            | Purpose                                      |
| ------ | -------------------------------- | --------------- | -------------------------------------------- |
| GET    | `/api/auth/config`               | Public          | Supabase client config bootstrap             |
| GET    | `/api/auth/user`                 | isAuthenticated | Current user; optional background sync hooks |
| POST   | `/api/auth/logout`               | Public          | Auth session logout acknowledgement          |
| POST   | `/api/user/update-username`      | isAuthenticated | Update profile username                      |
| POST   | `/api/user/update-profile-image` | isAuthenticated | Update avatar URL                            |
| POST   | `/api/user/onboarding/complete`  | isAuthenticated | Mark onboarding complete                     |

## AMM Trading Endpoints

Source: `server/routes/amm.ts`

| Method | Path                       | Auth            | Notes                                                       |
| ------ | -------------------------- | --------------- | ----------------------------------------------------------- |
| GET    | `/api/amm/:playerId`       | Public          | Returns pool state (auto-creates pool if needed)            |
| GET    | `/api/amm/:playerId/quote` | Public          | `type=buy` or `type=sell`, plus `amount`                    |
| POST   | `/api/amm/:playerId/buy`   | isAuthenticated | Body: `sbAmount`, optional `maxSlippage`                    |
| POST   | `/api/amm/:playerId/sell`  | isAuthenticated | Body: `sharesAmount` (whole number), optional `maxSlippage` |

Key invariants:

- Buy/sell paths enforce input validation and slippage bounds.
- Sell path requires integer `sharesAmount`.

## LP Endpoints

Source: `server/routes/lp.ts`

| Method | Path                            | Auth            | Notes                                         |
| ------ | ------------------------------- | --------------- | --------------------------------------------- |
| GET    | `/api/lp/positions`             | isAuthenticated | All user LP positions                         |
| GET    | `/api/lp/:playerId/position`    | isAuthenticated | Position for one player pool                  |
| POST   | `/api/lp/:playerId/add`         | isAuthenticated | Add liquidity with explicit share/SB amounts  |
| POST   | `/api/lp/:playerId/add-optimal` | isAuthenticated | Add liquidity with max constraints            |
| GET    | `/api/lp/:playerId/zap-quote`   | isAuthenticated | Single-sided zap quote (`shares` or `sb`)     |
| POST   | `/api/lp/:playerId/zap-add`     | isAuthenticated | Single-sided zap execution (`shares` or `sb`) |
| POST   | `/api/lp/:playerId/remove`      | isAuthenticated | Remove liquidity by LP shares                 |
| GET    | `/api/lp/:playerId/history`     | isAuthenticated | LP tx history by player                       |
| GET    | `/api/lp/history`               | isAuthenticated | LP tx history across pools                    |

## Legacy Vesting Endpoints (Retired)

Vesting routes still exist in the codebase for archival compatibility, but vesting is retired and out of the active product and current agent scope.

## Scout Endpoints

| Method | Path                             | Auth            | Purpose                         |
| ------ | -------------------------------- | --------------- | ------------------------------- |
| GET    | `/api/scouts`                    | isAuthenticated | Assignment list + capacity      |
| POST   | `/api/scouts/assign`             | isAuthenticated | Set assignment count for player |
| GET    | `/api/scouts/roster/:playerId`   | isAuthenticated | Roster view for player scouts   |
| GET    | `/api/scouts/status`             | isAuthenticated | Status snapshot endpoint        |
| GET    | `/api/scouts/velocity/:playerId` | Public          | Velocity signal by player       |
| GET    | `/api/scouts/trending`           | Public          | Trending scout player IDs       |

## Daily & Community Boost Endpoints

| Method | Path                                     | Auth            | Purpose                              |
| ------ | ---------------------------------------- | --------------- | ------------------------------------ |
| GET    | `/api/daily-boosts/all`                  | isAuthenticated | All current boosts across sports     |
| GET    | `/api/daily-boosts/eligible-all`         | isAuthenticated | Eligible players across sports       |
| GET    | `/api/daily-boosts/eligible/:sport`      | isAuthenticated | Eligible players for one sport/date  |
| POST   | `/api/daily-boosts/assign`               | isAuthenticated | Assign player to boost slot          |
| DELETE | `/api/daily-boosts/:boostId`             | isAuthenticated | Remove active boost before lock      |
| GET    | `/api/daily-boosts/live/:sport`          | isAuthenticated | Live boost status/payout view        |
| GET    | `/api/daily-boosts/history`              | isAuthenticated | Payout history                       |
| GET    | `/api/daily-boosts/:sport`               | isAuthenticated | Boosts for sport/date                |
| GET    | `/api/community-boosts/all`              | isAuthenticated | Community boosts across sports       |
| GET    | `/api/community-boosts/:sport`           | isAuthenticated | Community boosts by sport/date       |
| POST   | `/api/community-boosts/create`           | isAuthenticated | Create community boost               |
| GET    | `/api/community-boosts/history`          | isAuthenticated | User community boost history         |
| GET    | `/api/community-boosts/eligible-players` | isAuthenticated | Eligible players for community boost |

Important behavior:

- Daily boost assignment currently enforces exactly one share per slot.
- Community boosts increase daily boost multiplier via per-player community boost count.

## Premium / Checkout / Commerce Endpoints

| Method | Path                              | Auth            | Purpose                                      |
| ------ | --------------------------------- | --------------- | -------------------------------------------- |
| POST   | `/api/premium/redeem`             | isAuthenticated | Burn premium share for premium access window |
| POST   | `/api/premium/checkout-session`   | isAuthenticated | Create premium share checkout                |
| POST   | `/api/community/checkout-session` | isAuthenticated | Create community share checkout              |
| POST   | `/api/checkout/finalize`          | isAuthenticated | Idempotent checkout reconciliation           |
| GET    | `/api/premium/status`             | isAuthenticated | Premium entitlement status                   |
| GET    | `/api/premium/market-data`        | Public          | Premium-market data                          |
| POST   | `/api/webhooks/whop`              | Public          | Whop webhook receiver                        |

## Admin / Job Operations (High Impact)

Representative endpoints (not exhaustive):

- `GET /api/admin/agent/settings` (adminAuth)
- `PATCH /api/admin/agent/settings` (adminAuth)
- `GET /api/admin/agent/providers/:provider/models` (adminAuth)
- `GET /api/admin/agent/question-logs` (adminAuth, returns recent prompts plus exact-frequency rollups, semantic route counts, and semantic clusters)
- `POST /api/admin/jobs/trigger` (adminAuth)
- `POST /api/admin/jobs/:jobName/trigger` (isAuthenticated + admin checks in handler path)
- `GET /api/admin/diagnostics` (adminAuth)
- `GET /api/admin/route-smoke` (adminAuth)
- `POST /api/admin/backfill` (adminAuth)
  Treat admin endpoints as production-impacting operations.

## WebSocket Interface

Server path: `/ws`

Published event types include:

- `portfolio`
- `scouts`
- `trade`
- `liveStats`
- `scout_payout`
- `boost_settled`
- `COMMUNITY_BOOST_SETTLED`
- `scout_update`
- `scout_ready`
- `whale_alert`
- `scout_velocity_update`
- `trending_players_update`

Reference: `server/websocket.ts`.
