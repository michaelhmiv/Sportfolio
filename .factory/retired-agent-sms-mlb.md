# Implement the approved Sportfolio retired-surface refactor

Work directly in this repository and implement the complete scope below. Do not merely provide a plan or report. Inspect dependencies before deleting code, preserve legitimate Sportfolio functionality, run tests, and leave a reviewable implementation.

Do not modify `.github/workflows/**`. Do not push, merge, change Railway, expose secrets, or execute destructive production database changes. A separate workflow will validate and commit your working-tree changes.

## Product decision

Hermes, the Sportfolio agent/copilot product system, agent threads/plans/strategies/memories/schedules/BYOK/provider selection, SMS account linking/interactions, and Telnyx are retired features. Remove them rather than hiding or deprecating them.

There must be no active runtime, UI, API, MCP, current-schema, test, environment-template, generated-current-doc, or current product-documentation surface that presents them as Sportfolio features.

Do not blindly remove unrelated technical uses of “agent,” such as the standard HTTP `User-Agent` header, repository automation, or market-maker bot behavior that is not part of the retired copilot product. Historical already-applied migrations may remain immutable production history, but active schema definitions and new generated artifacts must not retain the retired feature model.

## Required end state

1. Delete the product runtime under `server/agent/**` after extracting any still-needed MLB transport logic and any narrowly required gameplay confirmation logic.
2. Remove all Hermes-specific product code, imports, logs, tests, docs, and environment variables (`HERMES_*`).
3. Remove all agent/copilot/BYOK/thread/strategy/memory/schedule/research/skill/provider-selection public tools, REST routes, UI, jobs, retention code, active schema definitions, relations, generated types, fixtures, and tests.
4. Remove SMS and Telnyx completely: services, routes, MCP tools, UI, tests, current docs, active schema/events, and env vars (`SMS_LINK_SECRET`, `TELNYX_*`). Old `/api/agent/*` and `/api/sms/*` routes should be absent and return ordinary 404 responses.
5. Preserve legitimate Sportfolio market, portfolio, scouting, watchlist, collections, news, authentication, OAuth/plugin, and confirmation behavior for real gameplay writes.
6. Preserve the useful internal MLB MCP integration, but move it to neutral provider code under a path such as `server/mcp/providers/mlb/**`. It must not import agent/Hermes types.
7. Replace dynamic publication of downstream MLB tools with a static semantic Sportfolio facade. No public tool may begin with `mlb_mcp__`, and downstream discovery must never add or remove public tools.
8. Curated MLB tools must remain present in `tools/list` even when the downstream provider is unavailable. Provider outages must produce typed structured errors, not missing-tool behavior.
9. Add a reviewed destructive migration and runbook, but do not make ordinary beta/prod startup auto-run it. The application must operate both before and after retired tables are physically dropped because beta and production share the production database.

## Neutral MLB provider

Move/rewrite the useful internal MLB MCP transport into neutral provider abstractions. Replace agent-specific types with provider-specific types.

Use neutral configuration:

- `MLB_MCP_ENABLED`
- `MLB_MCP_URL`
- `MLB_MCP_TIMEOUT_MS`
- `MLB_MCP_HEALTH_CACHE_MS`
- `MLB_MCP_AUTH_BEARER`

Do not retain compatibility reads for old `HERMES_*` variables in active source. Remove configurable public raw-tool prefixes.

The provider should have bounded connection and call timeouts, one safe transient retry with jitter where appropriate, response-size limits, credential/header redaction, health/circuit-breaker behavior, and normalized errors such as:

- `mlb_provider_disabled`
- `mlb_provider_unavailable`
- `mlb_provider_timeout`
- `mlb_provider_protocol_error`
- `mlb_remote_tool_missing`
- `mlb_invalid_request`
- `mlb_upstream_error`

## Static curated public MLB tools

Define a stable semantic set approximately matching the following names; adapt only where established repository conventions require it:

- `search_mlb_players`
- `get_mlb_batting_leaders`
- `get_mlb_pitching_leaders`
- `get_mlb_player_stats`
- `get_mlb_player_splits`
- `get_mlb_team_leaders`
- `get_mlb_games`
- `get_mlb_game_details`
- `get_mlb_probable_pitchers`
- `get_mlb_standings`
- `get_mlb_roster`
- `get_mlb_statcast_profile`

Descriptions and schemas must be intent-oriented and explicit enough that ChatGPT selects the correct tool for prompts such as:

- “Who are the top five MLB hitters in OPS this season?” → batting leaders
- “Who are the top five MLB pitchers in ERA this season?” → pitching leaders
- “What MLB games are being played today?” → games

Map semantic metrics to downstream provider capabilities internally. Bound limits, validate seasons/leagues, define qualification behavior where relevant, and normalize provider output.

The public catalog must be statically defined in Sportfolio. Downstream discovery may validate remote compatibility, but must not mutate the public catalog.

When the provider is unavailable, calls should return a normal MCP structured error envelope with a concise summary and data such as `{ code: "mlb_provider_unavailable", retryable: true }`. The tool must remain discoverable.

## MCP registry cleanup

Audit and update all relevant registry/plugin/policy/testing/fixture/prompt/resource/catalog/submission/capability-matrix code.

Remove imports/dependency injection and public tools for:

- Hermes read/scan/plan/action execution
- Agent profiles/capabilities/provider selection/BYOK
- Agent threads/messages/research/plans/bundles
- Agent schedules/strategies/memories/skills
- SMS settings/linking/phone verification

Remove retired actions from destructive sets, confirmation maps, route references, fixture registries, generated manifests, submission tests, and tool-policy audits.

Preserve confirmation for actual Sportfolio writes. If generalized agent action bundles are currently required by real gameplay confirmations, extract the minimum into narrowly named gameplay transaction modules/types such as `PendingGameAction`, `confirm_game_action`, and `cancel_game_action`, rather than retaining a generalized agent runtime.

Bump catalog metadata to a neutral curated version and retain/add catalog integrity checks. Ensure no duplicate capabilities or raw downstream tool names.

## Backend removal

After extracting MLB and legitimate confirmation dependencies, delete `server/agent/**`, including provider/model/context/conversation/executor/planner/thread/runtime/memory/schedule/strategy/research/skills/embeddings/improvement/BYOK code and tests.

Remove every `/api/agent/*` route and route registration. Remove agent-specific CLI/admin endpoints while preserving unrelated administration and market maintenance.

Delete agent schedule processors, thread/memory/run retention, strategy execution, research cleanup, embedding jobs, improvement-candidate jobs, and agent-specific startup/schema bootstrap logic.

Delete SMS/Telnyx implementation and registration, including discovered files such as:

- `server/sms-service.ts`
- `server/routes/sms.ts`
- `server/services/telnyx-sms.ts`
- related tests and route registration

## Frontend removal

Remove product-facing agent/copilot and SMS UI from settings, admin, routing, navigation, status components, hooks, API types, onboarding, dialogs, mobile/desktop surfaces, and lazy bundles.

Delete obsolete E2E tests such as the agent-shell test and replace coverage with MCP/gameplay regression tests where appropriate. Do not leave skipped dead tests.

## Active database schema and controlled migration

Inventory the current Drizzle schema and remove all active retired product definitions, relations, insert/select schemas, and exported types. The discovered families include at least:

- `agent_system_settings`
- `agent_runtime_sessions`
- `agent_skills`
- `agent_skill_reviews`
- `user_agent_profiles`
- `user_agent_secrets`
- `user_agent_threads`
- `user_agent_runs`
- `user_agent_improvement_candidates`
- `user_agent_proposals`
- `user_agent_action_bundles`
- `user_agent_messages`
- `user_agent_memories`
- `user_agent_schedules`
- `user_agent_strategies`
- `user_agent_strategy_runs`
- `user_agent_strategy_events`
- `user_agent_message_embeddings`
- `sms_message_events`
- any additional directly related research/source/continuity/runtime/skill tables found during inspection

Create an explicit migration that drops foreign keys and child tables in reviewed order. Do not use a broad unreviewed `DROP ... CASCADE`. Do not rewrite already-applied historical migration files solely to erase words from history.

Add clear runbook steps for production backup, row counts/export if desired, deploying code to beta and production while old tables still exist, verifying neither service reads/writes them, running the drop migration once, and verifying surviving foreign keys/core features afterward. The migration must not be wired into ordinary auto-deploy startup.

## Configuration cleanup

Remove from active code, `.env.example`, validation, startup logs, tests, and current docs:

- `HERMES_*`
- `USER_AGENT_MANAGED_PROVIDER`
- `USER_AGENT_SECRET_KEY`
- `SMS_LINK_SECRET`
- `TELNYX_*`

Audit other AI-provider variables before deleting them. Remove one only when no surviving legitimate feature uses it.

Add neutral startup validation/logging for the new MLB provider configuration without exposing secrets.

## Documentation cleanup

Delete retired product documentation such as `docs/agent/**`, `AGENT_GUIDE.md`, and Telnyx/SMS setup docs. Update current MLB MCP docs, README/runbooks, UI surface matrix, onboarding/production docs, tasks notes where they describe active features, and regenerate generated docs manifests using established scripts.

Do not rewrite immutable historical records solely for cosmetic removal, but current user/developer documentation must not advertise retired features.

## Observability and diagnostics

Use existing observability conventions to add neutral structured catalog/provider telemetry:

- catalog version/hash/tool counts/provider configuration and health
- public tool to provider/remote mapping
- status, duration, output size, request ID, normalized error code/retryability

Never log tokens, authorization headers, private user data, or raw sensitive arguments.

Add/update an authenticated admin MCP diagnostics endpoint if the repository already has an appropriate pattern. It should expose catalog version/hash/tool names/counts, provider configuration/health/capability status, cache age/recent errors, and commit/environment metadata without secrets.

## Automated retired-surface guard

Add a repository audit script and package command that fail when active product code reintroduces prohibited retired references/imports/env names/routes/tools/schema/Telnyx/SMS/raw `mlb_mcp__` public names.

The audit must distinguish legitimate `User-Agent`, non-product development automation, immutable migration history, and other explicitly justified exceptions. Scan active source, tests, current docs, env templates, and generated manifests.

## Tests and validation

Implement/update tests for:

- MLB semantic metric/league/season/limit/qualification mappings
- provider unavailable/timeout/protocol/missing-tool/upstream/response-size/circuit recovery behavior
- static MCP catalog and outage-safe discovery
- no raw `mlb_mcp__` public tools
- no retired agent/SMS public tools
- old agent/SMS REST routes absent
- native Sportfolio gameplay, OAuth, plugin, scouting, and confirmation regressions
- schema and controlled migration validation using the repository’s normal test strategy
- generated manifests/submission artifacts where affected

Update or delete obsolete tests rather than skipping them.

Run and fix failures from at least:

- formatting/lint for changed source
- `npm run check`
- full `npm run test:run`
- `npm run public-tools:audit`
- the new retired-surface audit
- production `npm run build`
- relevant plugin readiness/OAuth/MCP regression commands already defined in the repository

## Acceptance criteria

The implementation is complete only when:

- `server/agent` product runtime is gone.
- No active Hermes product code/config/logging remains.
- No agent/copilot/BYOK/thread/strategy/memory/schedule/research product UI, route, MCP tool, job, current schema, or current documentation remains.
- No SMS/Telnyx feature surface/config remains.
- No public `mlb_mcp__*` tool remains.
- Curated MLB tools are statically registered and remain discoverable during provider failure.
- Provider failures return typed retryable errors.
- Legitimate Sportfolio gameplay/OAuth/plugin tests pass.
- Controlled database cleanup migration/runbook exists but ordinary deployment does not execute it automatically.
- Typecheck, full tests, public-tool audit, production build, and retired-surface audit pass or any pre-existing unrelated failures are explicitly documented with evidence.

Write a concise implementation report to `.factory-implementation-report.md` covering removed surfaces, resulting public MLB catalog, migration safety procedure, exact validation commands/results, known limitations, and rollback instructions.