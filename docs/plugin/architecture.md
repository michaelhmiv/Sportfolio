# Sportfolio Plugin Architecture

## Purpose

Sportfolio will expose a dedicated, versioned MCP surface for ChatGPT and Codex plugin distribution without changing the existing CLI-oriented MCP contract.

## Endpoint boundaries

- `POST /mcp` remains the broad authenticated MCP used by the repo-local CLI and manually configured MCP clients.
- `POST /mcp/plugin` is the marketplace-facing MCP endpoint.
- The two endpoints may reuse read services and domain adapters, but they must not share a registry, authentication middleware, response contracts, or release cadence.

## Marketplace v1 product contract

The first marketplace submission is a read-only Sportfolio companion. It may read public sports data and, after OAuth authorization, the connected user's Sportfolio portfolio, boosts, collections, watchlists, milestones, news, and composed setup insights.

Marketplace v1 must not:

- execute or stage trades, liquidity actions, boosts, scout changes, or other gameplay mutations;
- collect or return passwords, API keys, OAuth tokens, one-time codes, SMS-link tokens, cookies, or other credentials;
- create, list, or revoke Sportfolio API tokens;
- change usernames, profile images, onboarding state, SMS settings, schedules, agent settings, or BYOK configuration;
- initiate billing, checkout, funding, premium redemption, rewarded advertising, or purchases;
- expose admin, internal, debug, provider, database, request, session, or raw agent-thread details;
- dynamically add internal MLB sidecar tools to the published tool list.

## Authentication

The marketplace endpoint uses OAuth 2.1 through the existing Supabase Auth user base. The implementation must support PKCE, OAuth discovery, protected-resource metadata, supported client registration, audience validation, revocation, and MCP authentication challenges.

Manual `spt_...` API tokens remain available only to the existing `/mcp` and CLI surfaces.

## Registry governance

The marketplace registry is an explicit allowlist. Every tool definition must declare:

- stable name and title;
- when-to-use and when-not-to-use description;
- strict input schema;
- strict output schema;
- authentication requirement and security scheme;
- `readOnlyHint`, `openWorldHint`, and `destructiveHint`;
- data classification;
- deterministic fixtures;
- positive and negative selection prompts.

The published catalog must be snapshot-tested. New internal tools are denied by default.

## Data minimization

Marketplace adapters may call existing storage, service, or Hermes read paths, but must convert results into dedicated plugin DTOs. Raw ORM rows and broad internal objects are prohibited.

Responses must omit data that is not necessary to answer the tool's stated purpose, including email, phone, internal user IDs, authentication records, API-token metadata, full agent turns, pending bundles, provider configuration, stack traces, SQL details, and request identifiers.

## Transport and state

The marketplace MCP should use stateless Streamable HTTP unless a later reviewed feature requires protocol sessions. User identity comes from OAuth; durable state comes from the database; request continuity must not depend on a process-local session map.

## Versioning

- Marketplace v1 is read-only.
- A later version may add carefully selected confirmation-gated virtual gameplay actions only after the read-only release is approved and stable.
- Any tool name, schema, authentication, annotation, or result-contract change requires an intentional catalog version change and review.

## Rollout

The endpoint is controlled by `PLUGIN_MCP_ENABLED` and remains disabled in production until OAuth, privacy, metadata, CI, staging, and submission gates pass.
