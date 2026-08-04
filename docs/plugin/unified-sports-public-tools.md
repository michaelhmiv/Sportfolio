# Unified sports public tools

The ChatGPT and public MCP surface exposes five compact, read-only sports-data tools backed by Sportfolio's unified MLB, NHL, and NASCAR adapter registry:

- `get_supported_sports_capabilities`
- `search_sports_entities`
- `get_sports_entity`
- `get_event_slate`
- `get_event_live_state`

All requests require an explicit canonical sport selector. Unsupported sport/capability combinations fail closed. Schedule queries are bounded to fourteen days, list responses are paginated, provider freshness metadata is retained, and raw provider-prefixed tools remain excluded.

These tools do not access connected-user state and do not perform writes. Existing market, portfolio, scouting, boost, liquidity, account, and staged-confirmation tools remain separate.
