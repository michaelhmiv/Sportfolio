# AMM-Only Mode (Legacy Player Order-Book Archived)

Sportfolio player trading is **AMM-only**.

## Archived player-market endpoints

The legacy player order-book endpoints are retired and return `410 Gone`:

- `GET /api/orders/:playerId/preview`
- `POST /api/orders/:playerId`
- `POST /api/orders/:orderId/cancel`

## Active player trading endpoints

Use AMM endpoints only:

- `GET /api/amm/:playerId`
- `GET /api/amm/:playerId/quote?type=buy|sell&amount=...`
- `POST /api/amm/:playerId/buy`
- `POST /api/amm/:playerId/sell`

## Bot engine status

Legacy player order-book bot strategies, scheduler wiring, and manual trigger script are archived for AMM-only player markets.

> Note: Premium/community order books remain separate where explicitly implemented.
