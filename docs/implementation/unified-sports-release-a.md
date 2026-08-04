# Unified Sports Data — Release A

Status: validated by Plugin Readiness and Security Audit.

## Objective

Reduce the public Sportfolio MCP and ChatGPT app surface before introducing the unified MLB, NHL, and NASCAR adapter layer.

Sportfolio remains responsible for authenticated account state, holdings, virtual market state, AMM quotes and liquidity, trades, scouting, boosts, collections, watchlists, Sportfolio scoring, structured sports information, provider-to-Sportfolio identity mapping, and staged writes.

ChatGPT is responsible for general web research, sports news, injuries, trade rumors, narrative analysis, explanations, recommendations, and user-created scheduled summaries.

## Implemented public-surface policy

Release A removes these categories from public MCP registration and the ChatGPT marketplace catalog:

- Hermes agent capabilities and configuration;
- agent profile and BYOK management;
- agent threads, messages, and research sources;
- hosted research and advisory review tools;
- legacy advisory schedules;
- SMS linking and settings;
- generated news and daily digests;
- every dynamically discovered raw MLB provider tool prefixed `mlb_mcp__`.

The controlling rule is `server/mcp/public-tool-policy.ts`. Static tools and prompts are filtered through that policy. Dynamic MLB discovery remains available only as an internal compatibility path and contributes zero public tools.

## Marketplace catalog

The ChatGPT marketplace catalog contains 20 compact aliases after removing:

- `get_my_news_digest`;
- `review_my_sportfolio_setup`.

The approved shared MCP registry now exposes 72 static tools, including 24 writes, 11 staged actions, and five destructive actions. Skill guidance, marketplace documentation, adapters, the frozen catalog snapshot, and `chatgpt-app-submission.json` were regenerated from the approved catalog together.

## Retained public capabilities

Release A retains focused tools for:

- player search and focused player research;
- games and structured schedules;
- holdings and portfolio state;
- market state, quotes, staged buys and sells;
- scouting and staged scout assignments;
- daily and community boosts;
- collections and milestones;
- watchlists;
- liquidity positions and staged liquidity actions;
- profile/account controls;
- pending-action inspection, confirmation, and cancellation;
- public documentation;
- MCP Apps UI render tools added in PR #331.

## Safety and rollback

Release A does not:

- delete database tables or columns;
- remove production environment variables;
- remove the internal MLB compatibility client;
- retire the standalone `mlb-mcp` Railway service;
- delete legacy backend routes, jobs, or client pages;
- implement the unified sports adapters;
- change virtual-market economics.

Those physical cleanup steps are deferred to follow-on PRs after dependency and production-use verification. The release is reversible by reverting its merge commit and redeploying.

## Validation

The final head passed:

- public-tool policy audit;
- public-policy and surface-coverage tests;
- plugin and repository TypeScript checks;
- changed-file linting;
- production build;
- plugin unit tests;
- marketplace and UI audits;
- catalog freeze;
- package, privacy, submission-kit, and OpenAI submission-import checks;
- existing and marketplace MCP protocol smoke tests;
- live OAuth discovery and JWKS compatibility;
- production and full dependency audits;
- full-history secret scanning;
- CodeQL JavaScript/TypeScript analysis.

The MCP smoke test explicitly verifies that retired prompts and raw provider tools are not listed or present in capability resources, and that direct raw-tool calls return an MCP error result.

## Follow-on releases

Release B introduces sport-neutral internal types, an adapter registry, provider-ID resolution, and normalized NASCAR series identifiers. Later releases add curated MLB, NHL, and NASCAR adapters, compact sports-data tools, data-semantic corrections, observability, physical legacy-code deletion, and eventual standalone MLB service retirement after zero-use verification.
