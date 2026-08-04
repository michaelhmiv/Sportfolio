Implement the complete cleanup described by GitHub issue #338 in this repository. Make the actual code changes; do not return only a plan.

## Objective

Complete the rollback-safe cleanup following merged Release A PR #333. Remove retired end-user/runtime implementations while preserving all retained Sportfolio gameplay, account, and unified-sports migration paths.

## Remove retired runtime and client surfaces

Remove active implementation, registration, imports, routes, navigation, services, jobs, tests, generated artifacts, and documentation for:

- Hermes/agent workspace UI and end-user routes;
- agent configuration/BYOK/profile/thread/message/research-source/hosted-research services and public route surfaces;
- advisory review and strategy automation;
- legacy advisory schedules;
- generated news/daily digest compilation and presentation;
- SMS linking/settings/routes/services/UI/navigation/build entry points;
- temporary Release A implementation scaffolding, including `.github/workflows/release-a-implementation.yml`;
- raw MLB MCP compatibility code only where it is now unreachable and proven unused by internal runtime consumers.

The production scheduler currently still starts these retired jobs. They must be absent from registration, advertised job catalogs, startup logs, and manual dispatch after this change:

- `agent_advisory_schedules`
- `agent_live_strategies`
- `agent_strategy_events`
- `compile_digest`

The production client build must no longer emit SMS-link, agent/Hermes, advisory, or generated-digest chunks.

## Preservation boundaries

- Preserve database tables, columns, existing migrations, and historical rows for rollback and historical compatibility. Do not create destructive migrations.
- Preserve environment-variable compatibility; retired variables may become unused but must not be required at startup.
- Preserve all market, portfolio, scouting, boosts, collections, milestones, watchlists, liquidity, account/auth, documentation, staged-action, and MCP Apps UI capabilities retained by PR #333.
- Preserve all current MLB, NHL, and NASCAR persisted synchronization, statistics, gameplay, scoring, market, payout, and collection pipelines.
- Preserve the standalone Railway `mlb-mcp` service and any still-required internal client until later migration gates prove zero use.
- Keep every retired public MCP tool/prompt/resource and all `mlb_mcp__*` raw provider tools absent.
- Do not change Railway configuration or use Railway Agent.

## Required regression proof

Add or update tests proving:

- retired jobs cannot register, advertise, dispatch, or execute;
- retired HTTP routes are absent or return the repository's documented disabled/not-found response;
- retired tools/prompts/resources remain absent from both MCP endpoints and capability resources;
- no production runtime import graph loads retired agent/SMS/digest modules;
- no retired client route or lazy bundle appears in the production manifest;
- retained public MCP tools, OAuth, staged actions, market/portfolio/scouting/boost/collection/watchlist/liquidity/account capabilities, and MCP Apps UI resources still pass;
- current MLB/NHL/NASCAR jobs and existing external response contracts remain unchanged.

Update job-registry counts/contracts, scheduler tests, route tests, client routing/navigation tests, package scripts/dependencies, frozen catalogs, plugin skill/docs/privacy/submission artifacts, generated OpenAI submission JSON, snapshots, architecture/context documentation, and any import maps affected by the deletion.

## Validation and report

Run targeted tests while implementing and fix failures caused by the cleanup. The workflow will independently run the repository-wide validation matrix afterward.

Inspect the final production build output and document explicitly whether any `sms-link`, `agent`, `hermes`, `advisory`, or generated-digest chunk remains. Add a concise deletion inventory, preserved compatibility boundaries, known limitations, and rollback instructions to `.factory-implementation-report.md`.

Do not modify trusted files under `.github/workflows/`; the task workflow removes the temporary Release A workflow separately if needed through the reviewed branch diff boundary. If removing `.github/workflows/release-a-implementation.yml` is blocked by that boundary, leave a clear note in the report so it can be deleted in a separate reviewed commit.