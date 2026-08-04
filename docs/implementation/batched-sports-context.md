# Batched sports context implementation

Issue #345 adds `server/sports/context-service.ts` and one compact public MCP tool. Before this change, a multi-sport question required separate entity, schedule, stats, live-state, holdings, and watchlist calls. The service memoizes identical source requests, uses a single identity lookup batch, limits section concurrency to three, caps six sport requests, and enforces a four-second default deadline.

Diagnostics report source calls and cache hits. Tests prove duplicate schedule requests use one adapter call, mixed sports are ordered deterministically, partial provider failures retain successful sections, public access cannot load user exposure, authenticated exposure is sanitized, and oversized requests fail before provider access.

Rollback consists of reverting this PR; existing individual sports tools and adapters remain unchanged.
