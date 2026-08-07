---
name: sportfolio
description: Use when working with Sportfolio through its public authenticated MCP endpoint or repo-local CLI. Covers user-token authentication, MCP connection setup, shared public tools, account and portfolio reads, semantic MLB data, and confirmation-gated gameplay transactions.
---

# Sportfolio

Use MCP for protocol-level access and the repo-local CLI for terminal workflows. Prefer the web app for rich visual scanning.

## Authentication

- Create a user API token from `Profile -> CLI Access`.
- Send it as `Authorization: Bearer <token>`.
- Treat it as user-scoped, never admin access.
- Never place credentials in chat, logs, or shell history.

## MCP endpoints

- Production: `https://www.sportfolio.market/mcp`
- Local: `http://127.0.0.1:5000/mcp`
- Transport: Streamable HTTP

The public catalog includes account, portfolio, player, pool, boost, scout, watchlist, schedule, documentation, news, collection, liquidity, and semantic MLB tools.

## CLI

```bash
npm run cli -- auth login --token <token> --base-url https://www.sportfolio.market
npm run cli -- auth whoami
npm run cli -- docs search boosts
npm run cli -- portfolio summary
npm run cli -- tools list
npm run cli -- resources read sportfolio://capabilities
```

Use `--json` for machine-readable output.

## Safety model

- Reads are immediate.
- Gameplay mutations are staged as pending transactions.
- Execute only after explicit confirmation.
- Cancel the pending transaction when the user changes direction.
- Billing, funding, checkout, admin, and internal routes are not part of the public gameplay surface.

Use the narrowest tool available and ground responses in the connected user's virtual Sportfolio account.
