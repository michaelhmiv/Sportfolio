# Sportfolio Plugin Architecture

## Purpose

Sportfolio exposes a dedicated OAuth-backed MCP endpoint for ChatGPT and Codex while reusing the same shared public capability registry and business logic as the existing site MCP. This prevents the app from drifting into a weaker or inconsistent product surface.

## Endpoint boundaries

- `POST /mcp` remains the session-oriented MCP used by the repo-local CLI and manually configured clients with Sportfolio API-token authentication.
- `POST /mcp/plugin` is the stateless ChatGPT/Codex endpoint using OAuth 2.1.
- Both endpoints derive their static tools from `server/mcp/public-tool-registry.ts` and therefore expose the same supported user-facing capabilities.
- Transport, authentication, response sanitization, rate limits, observability, and release gates remain endpoint-specific.

## Full product contract

The app supports the authenticated user's shared public Sportfolio MCP surface, including:

- public documentation, player, schedule, and performance research;
- connected portfolio, holdings, balance, trade, boost, scouting, watchlist, collection, milestone, news, liquidity, schedule, profile, and activity reads;
- staged virtual market buys and sells;
- staged scouting, share stacking, daily boosts, community boosts, and liquidity operations;
- exact-bundle confirmation and cancellation;
- supported immediate watchlist, schedule, profile, onboarding, milestone, news, account, and premium controls;
- a static semantic MLB tool facade whose public catalog remains stable during provider outages.

The shared registry continues to exclude admin, internal, debug, raw database, mobile-store billing, unsupported provider-management, and web-only capabilities that are not part of the public MCP contract.

Sportfolio values and actions remain virtual gameplay only. The app does not provide real-money investing, securities transactions, wagering, betting, cash prizes, or cash-out functionality.

## Authentication

The marketplace endpoint uses OAuth 2.1 through the existing Supabase Auth user base. The implementation supports PKCE, OAuth discovery, protected-resource metadata, client registration, audience validation, revocation, and MCP authentication challenges.

A small set of documentation and public player/game research tools may be used without authentication. Every private-data or write tool declares OAuth 2 security. Manual `spt_...` API tokens remain limited to the existing `/mcp` and CLI surfaces.

## Action model

Staged actions reuse Sportfolio's existing preview and pending-bundle workflow:

1. A `stage_*` tool validates the current account state and produces the current virtual cost, holdings or balance impact, warnings, thread identifier, and pending-bundle identifier.
2. ChatGPT presents the preview and obtains explicit confirmation.
3. `confirm_pending_action` executes only the exact reviewed bundle.
4. `cancel_pending_action` abandons the bundle without applying the gameplay action.

Staging tools are write actions but are not destructive. The confirmation finalizer is marked destructive because it may complete an irreversible virtual transaction. Immediate write tools are annotated according to their actual effects.

## Registry governance

The marketplace static catalog is generated directly from the shared public site MCP registry. Every registered tool declares:

- stable name, title, and description;
- input schema and a marketplace output envelope schema;
- authentication requirement and security scheme;
- explicit `readOnlyHint`, `openWorldHint`, and `destructiveHint` values;
- execution, confirmation, and risk metadata;
- deterministic fixture inputs where available.

CI verifies exact static parity, prevents unauthenticated writes, requires output schemas, validates action annotations, and exercises the stateless endpoint. Dynamic MLB tools remain OAuth-only and are added only when their bounded source reports healthy discovery.

## Data minimization

Marketplace responses pass through a dedicated sanitizer before returning to ChatGPT. Passwords, secrets, provider keys, access and refresh tokens, authorization headers, cookies, service-role data, direct contact fields, stack traces, SQL details, session IDs, and request IDs are removed.

Pending thread and bundle identifiers required to continue an approved staged action may be returned. The app must not echo sensitive input values or expose raw internal state unrelated to the user-visible workflow.

## Transport and state

The marketplace MCP uses stateless Streamable HTTP. User identity comes from OAuth; durable account and pending-action state comes from the database. Request continuity does not depend on a process-local MCP session map.

## Versioning

- Version 2 introduces full shared-site-MCP parity and authenticated write actions.
- Static site MCP changes automatically appear in the marketplace catalog and must pass parity, annotation, privacy, package, submission, and protocol checks before merge.
- Material tool name, schema, authentication, annotation, confirmation, or result-contract changes require refreshed ChatGPT tool scanning and updated reviewer tests.

## Rollout

The endpoint remains controlled by `PLUGIN_MCP_ENABLED`. Production write support must not be considered released until OAuth client allowlisting, the custom access-token audience hook, ChatGPT action scanning, live positive and negative tests, reviewer credentials, and final submission gates are complete.
