---
id: agent-android-notification-audit-2026-05-28
title: Android Notification Audit (2026-05-28)
summary: End-to-end audit of Android push registration, token lifecycle, preference gating, provider delivery, and diagnostics with concrete remediation notes.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-05-28
changeTriggers: client/src/lib/mobile-push.ts,server/routes/mobile-push-notifications.ts,server/services/push-notifications.ts
slug: android-notification-audit-2026-05-28
surface: agent
searchKeywords: android,push,notifications,fcm,token,lifecycle,diagnostics,audit
---

# Android Notification Audit (2026-05-28)

## Scope

- Repository baseline: `origin/main` @ `17221bd7759e1bebbb1900ebb818d2471909f4f0`.
- Target: end-to-end Android notification delivery audit (registration -> token persistence -> preference gating -> provider send -> user receipt).
- Coverage: local code/runtime validation plus production-read evidence tooling.

## Notification Inventory Matrix

### A) Category dispatcher pipeline (legacy/general notifications)

- Service path: `sendUserNotification` / `sendNotificationToUsers` / `sendCategoryBroadcastNotification` in `server/services/notification-dispatcher.ts`.
- Token source: `user_push_devices` (via `getActivePushDevicesForUsers` in `server/services/notification-settings.ts`).
- Preference gate: `user_notification_settings.push_enabled` + `category_preferences`.

| Category                                  | Main emitters                                                                                      | Deep link                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------- |
| `trade_execution`                         | AMM buy/sell fills (`server/amm/pool.ts`)                                                          | `/player/:id`               |
| `whale_alerts`                            | AMM whale thresholds (`server/amm/pool.ts`)                                                        | `/player/:id`               |
| `lp_liquidity`                            | AMM LP add/remove/zap (`server/amm/pool.ts`)                                                       | `/player/:id`               |
| `account_security`                        | Username/avatar/device events (`server/routes.ts`, `server/routes/notifications.ts`)               | `/user/:id`                 |
| `scout_lifecycle`                         | Scout assignment + distribution ceremony (`server/routes.ts`, `server/jobs/scout-distribution.ts`) | `/player/:id`, `/portfolio` |
| `boost_lifecycle`                         | Boost assign/lock/settle (`server/routes.ts`, `server/jobs/*boost*`)                               | `/boosts`                   |
| `community_boosts`                        | Community boost create/settle (`server/routes.ts`, `server/jobs/settle-community-boosts.ts`)       | `/boosts`                   |
| `portfolio_changes`                       | Share payouts (`server/jobs/settle-share-payouts.ts`)                                              | `/portfolio`                |
| `player_news`                             | Relevant news fanout (`server/jobs/fetch-news.ts`)                                                 | `/news`                     |
| `daily_digest`                            | Digest completion/delay (`server/jobs/compile-digest.ts`)                                          | `/news`                     |
| `watchlist_alerts`                        | Signal detectors (`server/jobs/notification-signals.ts`)                                           | `/watchlists`               |
| `market_alerts`                           | Signal detectors (`server/jobs/notification-signals.ts`)                                           | `/pools`                    |
| `condense_opportunities`                  | Signal detectors (`server/jobs/notification-signals.ts`)                                           | `/portfolio`                |
| `leaderboard_competition`                 | Signal detectors (`server/jobs/notification-signals.ts`)                                           | `/leaderboards`             |
| `billing_premium`                         | Premium redeem/purchase/reminders (`server/routes.ts`, `server/jobs/notification-signals.ts`)      | `/premium`                  |
| `game_lifecycle`                          | Signal detectors (`server/jobs/notification-signals.ts`)                                           | `/portfolio`                |
| `system_operational`, `product_marketing` | Admin broadcast route (`server/routes/notifications.ts`)                                           | payload-defined             |

### B) Android push event pipeline (typed mobile notifications)

- Service path: `sendPushNotificationBestEffort` / `PushNotificationService` in `server/services/push-notifications.ts`.
- Token source: `user_push_tokens`.
- Preference gate: `user_notification_preferences` + defaults in `shared/push-notifications.ts`.
- Channel mapping: `getPushNotificationAndroidChannelId`.

| Push type                  | Emitted today | Emitter                                                              | Channel                | Route        |
| -------------------------- | ------------- | -------------------------------------------------------------------- | ---------------------- | ------------ |
| `boost_settled`            | Yes           | `server/services/push-notification-events.ts` via settle jobs        | `sportfolio_gameplay`  | `/boosts`    |
| `boost_locking_soon`       | Yes           | `server/services/push-notification-events.ts` via lock job           | `sportfolio_gameplay`  | `/boosts`    |
| `scout_complete`           | Yes           | `server/services/push-notification-events.ts` via scout distribution | `sportfolio_gameplay`  | `/portfolio` |
| `scout_capacity_available` | Yes           | `server/services/push-notification-events.ts` via scout distribution | `sportfolio_gameplay`  | `/portfolio` |
| `portfolio_movement`       | No            | Defined only                                                         | `sportfolio_market`    | n/a          |
| `order_filled`             | No            | Defined only                                                         | `sportfolio_gameplay`  | n/a          |
| `watchlist_news`           | No            | Defined only                                                         | `sportfolio_watchlist` | n/a          |
| `watchlist_price_move`     | No            | Defined only                                                         | `sportfolio_watchlist` | n/a          |
| `premium_reward_available` | No            | Defined only                                                         | `sportfolio_gameplay`  | n/a          |
| `system_announcements`     | No            | Defined only                                                         | `sportfolio_system`    | n/a          |

## Registration / Token Lifecycle Findings

- Canonical Android registration calls `registerForAndroidPushes()` in `client/src/lib/mobile-push.ts`, then backend sync occurs from `MobilePushManager` registration listener (`/api/mobile/push/register`).
- Logout deactivation runs through `unregisterPushTokenOnLogout()` (`/api/mobile/push/unregister`).
- Before this audit's fix, app root mounted both:
  - `PushNotificationProvider` (legacy registration/unregister path hitting `/api/account/notifications/push/*`).
  - `MobilePushManager` (new path hitting `/api/mobile/push/*`).
- That created dual lifecycle ownership and possible registration/unregister ordering drift.

## Root-Cause Analysis

### Confirmed

1. Dual client lifecycle overlap (high confidence, fixed)
   - Evidence: both providers were mounted in `client/src/App.tsx` and both issued register/unregister side effects.
   - Risk: token state churn and non-deterministic store updates across app resume/auth transitions.

2. Over-broad token invalidation (high confidence, fixed)
   - Evidence: `server/services/push-notifications.ts` treated `messaging/invalid-argument` as a token-invalid signal and deactivated tokens.
   - Risk: payload/config/project errors could deactivate valid tokens across many users, suppressing future delivery.

3. False-positive delivery readiness in diagnostics (high confidence, fixed)
   - Evidence: `/api/mobile/push/status` used env-presence (`hasFirebasePushCredentialsConfigured`) rather than provider-init readiness.
   - Risk: UI/ops saw "configured" while parse/init still failed.

4. Notification storage schema absent in linked Supabase project (high confidence, needs migration)
   - Evidence (queried 2026-05-28 via `supabase db query --linked`): no `public` tables exist for
     `user_push_tokens`, `user_push_devices`, `user_notification_preferences`, `user_notification_settings`, or `push_notification_events`.
   - Risk: Android registration, token persistence, preference reads/writes, and delivery telemetry cannot function in that environment because backing tables are missing.

### Still possible / needs production evidence

1. Cross-project token mismatch (`SENDER_ID_MISMATCH`) (medium confidence)
   - Needs provider error distribution and app-project alignment checks from production logs.

2. Residual dual-table drift (`user_push_tokens` vs `user_push_devices`) (medium confidence)
   - Bridging exists in `/api/mobile/push/register` and `/api/mobile/push/unregister`, but historical drift may remain until reconciled.

### Ruled out locally

- Missing Android manifest permission and channel setup.
- Missing Capacitor push plugin wiring.
- Route-order issue for `/api/mobile/push/*` behind `/api` 404 fallback.

## Production Evidence Status

- Added read-only audit command: `npm run audit:android-push -- --lookback-days 14 [--json]`.
- Supabase CLI access is available in-session and linked to project ref `xolfyrbtkmwgllrazcfh`.
- Live linked-query evidence collected on 2026-05-28:
  - `select count(*) from public.users` returned `24`, confirming the database is reachable.
  - `information_schema.tables` contains no `notification`/`push` tables in `public`.
  - Explicit lookup for `user_push_tokens`, `user_push_devices`, `user_notification_preferences`, `user_notification_settings`, and `push_notification_events` returned no rows.
- Some Supabase linked queries intermittently triggered pooler/auth throttling when run in parallel. Sequential queries were stable.
- Result: root-cause confidence increased for schema drift/migration gap in the linked environment.

## Remediation Implemented in This Audit

1. Consolidated client registration authority
   - Removed root-level `PushNotificationProvider` mount from `client/src/App.tsx`.
   - Updated `NotificationSettingsCard` to use Android mobile push helpers (`mobile-push.ts`) instead of legacy context registration.

2. Hardened provider diagnostics
   - Added provider-init diagnostics in `server/services/push-notifications.ts`:
     - credential source,
     - init attempted,
     - ready/not-ready,
     - project id,
     - last init error.
   - `/api/mobile/push/status` now uses initialized provider diagnostics (not env presence only).

3. Prevented unsafe token deactivation
   - Removed `messaging/invalid-argument` from automatic invalid-token deactivation list.
   - Added regression coverage in `server/services/push-notifications.test.ts`.

4. Added operational audit tooling
   - New script: `scripts/android-push-audit-report.mjs`.
   - New npm command: `npm run audit:android-push`.
   - Updated mobile runbook docs to reference the script and corrected channel naming.

## Validation

- Push-focused tests:
  - `npm run test:run -- client/src/lib/mobile-push.test.ts server/services/push-notifications.test.ts server/services/notification-dispatcher.test.ts server/routes/mobile-push-notifications.test.ts`
  - Result: passed.
