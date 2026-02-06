# AMM-Only Mode (Legacy Order-Book Archived)

Sportfolio now defaults to **AMM-only trading** for player markets.

## What is archived

The legacy player order-book endpoints are disabled by default:

- `GET /api/orders/:playerId/preview`
- `POST /api/orders/:playerId`
- `POST /api/orders/:orderId/cancel`

These endpoints now return `410 Gone` in AMM-only mode.

## Active trading endpoints

Use AMM endpoints only:

- `GET /api/amm/:playerId`
- `GET /api/amm/:playerId/quote?type=buy|sell&amount=...`
- `POST /api/amm/:playerId/buy`
- `POST /api/amm/:playerId/sell`

## Bot engine status

Legacy order-book bot engine is disabled in scheduler and admin trigger paths.

## Optional override (not recommended)

To temporarily re-enable legacy order-book routes, set:

- `MARKET_MODE=orderbook`

Default behavior without this env var is AMM-only.
