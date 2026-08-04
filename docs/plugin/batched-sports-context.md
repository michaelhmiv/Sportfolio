# Batched sports context

`get_sports_context` assembles only explicitly requested MLB, NHL, and NASCAR sections. It deduplicates source calls, resolves provider references once, bounds concurrency and date ranges, preserves per-section freshness and warnings, and returns partial results deterministically when one source fails.

Connected-user exposure is available only through authenticated MCP execution and is reduced to player IDs, share quantities, locked shares, multipliers, and watchlist membership. Public service calls cannot retrieve this section. No account credentials, balances, email addresses, trade history, or write behavior are included.

Current adapters do not expose standings or leaguewide leader contracts. Requests for those sections return an explicit unsupported status rather than inferred substitute data.
