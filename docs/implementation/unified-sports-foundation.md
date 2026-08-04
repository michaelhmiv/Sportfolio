# Unified Sports Foundation

This release introduces behavior-preserving internal contracts for MLB, NHL, and NASCAR. It does not change public MCP tools, scheduler registrations, providers, market economics, or database topology.

The foundation includes runtime-validated sport, athlete, team, game, statistics, live-state, provider-reference, freshness, and error contracts; a fail-closed adapter registry; batched provider-identity resolution through an injected existing-storage lookup; canonical NASCAR Cup/Xfinity/Truck identifiers; and a reusable sync telemetry wrapper.

Concrete adapters will wrap the repository's existing MLB StatsAPI, NHL web API, NASCAR API, and persisted Sportfolio data in subsequent releases. Existing consumers remain unchanged until each adapter passes parity tests.
