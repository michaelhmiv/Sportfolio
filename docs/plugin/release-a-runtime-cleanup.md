# Release A Runtime Cleanup

The Release A public-capability policy is now reinforced at runtime.

The production scheduler no longer registers or dispatches the retired generated-digest, agent advisory-schedule, live-strategy, or strategy-event jobs. The web client no longer registers the SMS-link route or emits its lazy bundle.

These runtime removals do not change the approved ChatGPT app surface. Raw `mlb_mcp__*` provider tools, retired advisory prompts, SMS tools, generated-digest aliases, and Hermes/agent tools remain absent from the public MCP and marketplace catalogs. Retained market, portfolio, scouting, boost, collection, watchlist, liquidity, account, OAuth, staged-action, documentation, and MCP Apps UI capabilities are unchanged.

Historical database structures, migrations, environment-variable compatibility, the internal MLB compatibility client, and the standalone `mlb-mcp` Railway service remain in place for rollback and later gated migration.
