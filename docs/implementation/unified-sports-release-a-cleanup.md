# Unified Sports Release A Cleanup

This cleanup removes active registration and client entry points for the retired agent advisory, strategy, generated-digest, and SMS-link capabilities.

## Removed from runtime

- `compile_digest`
- `agent_advisory_schedules`
- `agent_live_strategies`
- `agent_strategy_events`
- the `/sms/link` client route and its lazy chunk entry point
- obsolete SMS client implementation files
- the one-shot Release A implementation workflow

## Preserved for rollback and migration safety

Database tables, historical records, migrations, environment-variable compatibility, the internal MLB compatibility client, the standalone `mlb-mcp` service, and all retained market, portfolio, scouting, boost, collection, watchlist, liquidity, account, OAuth, staged-action, and MCP Apps UI capabilities are unchanged.

A revert of the cleanup merge restores the active registrations without requiring data restoration.
