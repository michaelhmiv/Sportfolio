Implement GitHub issue #339 completely in this repository. Make the actual behavior-preserving code changes; do not return only a plan.

## Objective

Introduce the internal sport-neutral foundation required to migrate MLB, NHL, and NASCAR data access while preserving every existing public response, persisted gameplay behavior, scheduler cadence, scoring rule, market calculation, and client contract.

## Neutral runtime-validated contracts

Create typed Zod/runtime-validated contracts for at least:

- canonical sport, league, season, competition/series, provider, and provider capability identity;
- canonical Sportfolio athlete/driver, team/organization, and game/event identifiers;
- provider athlete/team/game/event/season/series identifiers and provider provenance;
- athlete/driver summary and detail;
- team/organization summary and detail where applicable;
- game/event summary and detail;
- schedule query/result and normalized date range;
- standings and leaders;
- recent performance and season performance;
- live game/race state;
- box-score/stat lines supporting team sports and motorsports without inventing unsupported fields;
- injury/availability status as supported, partial, unavailable, or unknown;
- source freshness, observed-at/source-updated-at watermarks, persisted-versus-upstream origin, warnings, partial-data status, and stale state;
- normalized pagination;
- provider error taxonomy including unsupported capability, invalid identity, ambiguous identity, not found, rate limited, timeout, upstream unavailable, malformed payload, stale data, and internal failure;
- adapter health and capability metadata.

Provider-native payload types must remain inside provider adapter modules and must not escape public/shared adapter result boundaries.

## Adapter interface and registry

Create a sport adapter interface and registry that:

- registers MLB, NHL, and NASCAR adapters by canonical sport key;
- supports capability discovery and fail-closed adapter/capability lookup;
- rejects duplicate registration and mismatched sport/provider metadata;
- supports dependency injection, deterministic fixtures, and test doubles;
- provides cancellation/deadline support and bounded query options;
- contains no new public MCP registration in this foundation PR;
- can initially delegate through thin behavior-preserving wrappers around existing services/jobs.

## Provider identity resolution

Create a batch-capable provider identity resolver that:

- maps provider IDs to canonical Sportfolio IDs for athletes/drivers, teams/organizations, games/events, seasons, and NASCAR series;
- reuses existing alias/canonicalization/storage facilities where available instead of duplicating identity logic;
- explicitly represents resolved, unresolved, ambiguous, conflicting, and retired mappings;
- returns provider and resolution provenance and confidence/evidence where currently available;
- performs batch lookup without N+1 queries;
- never invents or silently coerces a canonical mapping;
- can be dependency-injected and tested without a live database.

## NASCAR series normalization

Introduce one canonical internal representation for Cup, Xfinity, and Truck series plus an explicit unknown/unsupported path. Accept existing aliases at input boundaries, normalize case/spacing/provider codes, and emit only canonical values in new contracts. Preserve historical persisted values and all current external response shapes; do not perform destructive data rewrites.

## Sync-run observability foundation

Integrate with existing job logs/metrics where possible and define a structured sync-run record containing:

- run ID, sport, provider, capability/job, start/end/duration, status;
- records read/written/skipped, unresolved identities, partial failures;
- rate-limit/upstream status, retry count where available, freshness watermark;
- structured bounded warnings and error classification;
- no raw provider payloads, credentials, tokens, PII, private account data, or high-cardinality entity labels.

Support success, partial, failed, cancelled, skipped/no-event, and zero-record outcomes without treating ordinary offseason/no-game results as failures.

## Compatibility boundaries

- Existing MLB, NHL, and NASCAR scheduled jobs continue using current implementations unless wrapped with a zero-behavior adapter boundary.
- Preserve all existing API, MCP, plugin, UI, database, scheduler, scoring, market, boost, collection, payout, scouting, and account behavior.
- Preserve current canonical IDs and response shapes at all existing external boundaries.
- Do not create destructive migrations, provider cutovers, new public tools, Railway changes, or standalone `mlb-mcp` retirement.
- Add representative adapter contract fixtures for all three sports even where concrete methods initially delegate to existing services.
- Avoid broad dependency upgrades unrelated to this work.

## Required tests

Add comprehensive tests for:

- contract parse/serialize round trips and invalid payload rejection;
- null versus zero and unsupported versus unknown distinctions;
- registry registration, duplicate rejection, unsupported sport/capability, fail-closed behavior, and dependency injection;
- provider identity resolved/unresolved/ambiguous/conflict/retired cases and batched query behavior;
- NASCAR alias normalization and canonical round trips;
- freshness/provenance/warning/partial propagation;
- sync-run success, partial, upstream failure, cancellation, no-event, and zero-record outcomes;
- cardinality/redaction boundaries;
- compatibility snapshots proving current API, MCP, scheduler registry, and representative gameplay outputs are unchanged.

## Documentation and report

Document module boundaries, contract invariants, error taxonomy, identity invariants, migration sequence for MLB/NHL/NASCAR, explicit non-goals, and how later adapters will be introduced. Add a file-level implementation inventory, tests run, known limitations, and rollback instructions to `.factory-implementation-report.md`.

Run targeted tests while implementing and fix failures caused by the changes. The task workflow will independently run the repository-wide validation matrix after implementation. Do not modify trusted files under `.github/workflows/` and do not use Railway Agent.