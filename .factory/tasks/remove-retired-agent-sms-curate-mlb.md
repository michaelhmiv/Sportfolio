# Task: Remove retired agent/Hermes/SMS product systems and curate the MLB MCP surface

Implement this entire refactor in the current repository. Work directly in the codebase, inspect dependencies before editing, and leave the branch in a buildable, tested state. Do not modify trusted workflow files.

## Product decision

Hermes, the Sportfolio agent/copilot system, agent threads/plans/strategies/memories/schedules/BYOK/provider configuration, SMS account linking/interactions, and Telnyx are retired features. Remove them rather than hiding or deprecating them. There must be no active runtime, UI, API, MCP, configuration, database-schema, test, or current documentation surface that presents these as Sportfolio features.

Do not blindly remove unrelated technical uses of the word `agent`, such as the standard HTTP `User-Agent` header or repository tooling that is clearly not part of the Sportfolio product runtime. Remove product-feature code and documentation. Historical already-applied migrations may remain immutable, but active schema definitions and new generated artifacts must not retain the retired feature model.

## Required end state

1. Delete the product runtime under `server/agent/**` after extracting any still-needed MLB transport logic and any narrowly required gameplay confirmation logic.
2. Remove all Hermes-specific code, imports, logs, tests, docs, and environment variables (`HERMES_*`).
3. Remove all agent/copilot/BYOK/thread/strategy/memory/schedule/research/skill/provider-selection public tools, REST routes, UI, jobs, retention code, schema definitions, relations, generated types, fixtures, and tests.
4. Remove SMS and Telnyx completely: services, routes, MCP tools, UI, tests, docs, schema, events, and env vars (`SMS_LINK_SECRET`, `TELNYX_*`). Old `/api/agent/*` and `/api/sms/*` routes should simply be absent/404.
5. Preserve legitimate Sportfolio functionality: market, portfolio, scouting, watchlists, collections, news, authentication, OAuth/plugin connection, and confirmation for real gameplay writes.
6. Preserve the useful internal MLB MCP integration, but move it to neutral provider code under a path such as `server/mcp/providers/mlb/**`. It must not import agent/Hermes types.
7. Replace dynamic publication of downstream MLB tools with a static semantic Sportfolio facade. No public tool may begin with `mlb_mcp__`, and downstream discovery must never add/remove public tools.
8. Curated MLB tools must remain in `tools/list` even when the downstream provider is unavailable. Provider outages should produce typed structured errors, not missing-tool behavior.
9. Keep beta/production safe with the shared production database: add a reviewed destructive migration, but do not wire it to auto-run during normal beta deployment. The application must run both before and after the retired tables are dropped.

## MLB provider architecture

Create neutral provider abstractions and typed errors. Rename configuration away from Hermes, using variables such as:

- `MLB_MCP_ENABLED`
- `MLB_MCP_URL`
- `MLB_MCP_TIMEOUT_MS`
- `MLB_MCP_HEALTH_CACHE_MS`
- `MLB_MCP_AUTH_BEARER`

Do not retain compatibility reads for old `HERMES_*` variables in active source.

The provider should have bounded connect and call timeouts, one safe transient retry with jitter where appropriate, response-size limits, credential redaction, health/circuit-breaker behavior, and normalized errors such as:

- `mlb_provider_disabled`
- `mlb_provider_unavailable`
- `mlb_provider_timeout`
- `mlb_provider_protocol_error`
- `mlb_remote_tool_missing`
- `mlb_invalid_request`
- `mlb_upstream_error`

## Curated public MLB tools

Define a static, stable set of approximately these semantic tools (adapt exact names only when repository conventions require it):

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

Descriptions and schemas must be intent-oriented and explicit enough that ChatGPT selects the right tool for prompts such as “Who are the top five MLB hitters in OPS this season?” and “Who are the top five MLB pitchers in ERA this season?”. Map semantic metrics to the downstream provider internally. Bound `limit`, validate seasons/leagues, and normalize provider output.

During an MLB provider outage, the tools must remain listed and calls should return a normal MCP error envelope such as a summary plus `{ code: "mlb_provider_unavailable", retryable: true }`.

## Public MCP registry cleanup

Audit and update all registry, plugin, policy, test, fixture, prompt/resource, catalog, and capability-matrix code. Remove dependencies on agent execution/profile/thread/SMS modules and remove retired actions from destructive sets, confirmation maps, route references, submission fixtures, generated manifests, and tool audits.

Preserve confirmation for actual Sportfolio writes. If existing agent action bundles are currently used for gameplay confirmation, extract the minimum into narrowly named gameplay transaction types/modules (for example `PendingGameAction`, `confirm_game_action`, `cancel_game_action`) rather than retaining a generalized agent runtime.

Update MCP catalog metadata to a new curated version and add/retain catalog integrity checks. Ensure no duplicate capabilities and no raw downstream MLB names.

## Backend/UI/docs cleanup

Remove product-facing agent and SMS routes, route registration, admin/settings pages or sections, status components, hooks, API types, navigation, onboarding copy, lazy bundles, and E2E tests. Delete retired Telnyx/SMS setup documentation and agent-feature documentation. Update current README/runbooks/UI matrices/MLB MCP docs and regenerate generated documentation manifests using repository scripts when available.

Remove retired startup logs and env template entries. Audit other AI-provider variables before deleting them; only remove a provider variable when no surviving feature uses it.

## Database

Inventory the active Drizzle schema and remove all retired product tables/relations/types, including the discovered families:

- `agent_system_settings`, `agent_runtime_sessions`, `agent_skills`, `agent_skill_reviews`
- `user_agent_profiles`, `user_agent_secrets`, `user_agent_threads`, `user_agent_runs`, `user_agent_improvement_candidates`, `user_agent_proposals`, `user_agent_action_bundles`, `user_agent_messages`, `user_agent_memories`, `user_agent_schedules`, `user_agent_strategies`, `user_agent_strategy_runs`, `user_agent_strategy_events`, `user_agent_message_embeddings`
- `sms_message_events`
- any additional directly related research/source/continuity/runtime/skill tables found during inspection

Create an explicit migration that drops dependencies in reviewed order, without a broad unreviewed `DROP ... CASCADE`. Include comments/runbook steps for backup, row counts, controlled execution after both beta and production run the new code, and verification. Do not mutate old applied migration files merely to erase history.

## Observability and diagnostics

Add neutral structured catalog/provider telemetry where consistent with current observability patterns. Catalog initialization should expose version/hash/tool counts/provider status. Invocation telemetry should record public tool, provider/remote mapping, status, duration, output size, request ID, and normalized error code without secrets or sensitive arguments.

Add or update an authenticated admin MCP diagnostics endpoint if the repository already has the appropriate admin diagnostics pattern. It should expose catalog version/hash/tool names/counts, provider configuration/health/capability state, cache age, recent errors, and commit/environment metadata without secrets.

## Automated guard

Add a repository audit script and package command that fail CI when active product code reintroduces prohibited retired references. It must distinguish legitimate `User-Agent`/developer-tooling cases. Scan active source, tests, docs, env templates, and generated manifests. At minimum prohibit product references/imports for Hermes, `server/agent`, agent feature routes/tools/schema, SMS/Telnyx feature code, old env variables, and `mlb_mcp__` public names.

## Tests and validation

Implement and run all relevant repository validation, fixing failures caused by the refactor. At minimum:

- formatting/lint for changed source
- TypeScript typecheck
- full unit/integration test suite
- public MCP tool audit
- production build
- new retired-surface audit
- MCP catalog contract tests proving curated MLB tools are static and remain listed when provider health is false
- provider unit tests for metric mappings, validation, timeout/unavailable/protocol/missing-tool errors, response limits, and recovery
- route regression tests proving old agent/SMS routes are absent
- schema/migration validation against the repository’s normal test database strategy
- relevant plugin readiness/OAuth/MCP regression tests

Update/delete obsolete tests rather than skipping them.

## Acceptance checks

The implementation is not complete unless repository search and tests establish all of the following:

- `server/agent` product runtime is gone.
- No active Hermes code/config/logging remains.
- No product agent/copilot/BYOK/thread/strategy/memory/schedule/research UI, route, MCP tool, job, schema, or current documentation remains.
- No SMS/Telnyx feature surface or config remains.
- No public `mlb_mcp__*` tools remain.
- Curated MLB tools are statically registered and remain discoverable during provider failure.
- Legitimate native Sportfolio gameplay and OAuth/plugin functionality still pass tests.
- The destructive DB migration is present but not automatically executed by ordinary deployment.
- `npm run check`, the full tests, public tool audit, production build, and new retired-surface audit pass.

Provide a concise implementation report in the PR changes themselves (docs or PR-ready summary is fine) listing the resulting tool catalog, removed surfaces, migration safety procedure, and exact validation commands/results.