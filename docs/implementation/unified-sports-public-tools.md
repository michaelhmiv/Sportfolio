# Unified sports public tools

Issue #344 adds five compact read-only tools backed exclusively by the unified adapter registry.

- `get_supported_sports_capabilities`
- `search_sports_entities`
- `get_sports_entity`
- `get_event_slate`
- `get_event_live_state`

Every request requires a canonical `sport` value (`mlb`, `nhl`, or `nascar`). Unsupported sport/capability combinations fail closed with a typed error. Schedule ranges are limited to 14 days, item counts are bounded, results are deterministically ordered, and provider freshness/provenance is preserved on normalized entities.

No raw provider response, provider-native tool prefix, connected-user state, or write behavior is exposed. Existing authenticated market, portfolio, scouting, boost, liquidity, account, and staged-action tools remain separate.

Rollback consists of reverting this PR; the internal adapters and existing gameplay surfaces are unchanged.
