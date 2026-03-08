---
id: getting-started-access
title: How to Access Sportfolio
summary: The fastest way to reach Sportfolio from web, mobile, SMS, and CLI, plus the current status of external MCP-style access.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-03-08
changeTriggers: client/src/App.tsx,client/src/components/bottom-nav.tsx,client/src/components/cli-access-card.tsx,client/src/pages/wiki.tsx,packages/sportfolio-cli,server/routes/docs.ts,server/routes/mcp.ts
slug: access
surface: web,cli,agent
searchKeywords: access,how do i access sportfolio,mcp,model context protocol,cli,api token,sms,agent,wiki,mobile
---

# How to access Sportfolio

Sportfolio currently gives you four documented access paths:

- **Web agent** at `/agent`
- **Wiki and handbook** at `/wiki`
- **SMS agent** after linking your phone number
- **CLI** with a user-scoped API token

If you want help or product explanations, the fastest starting point is the wiki. If you want account-specific help, use the web agent or SMS after linking.

## Web and mobile

The main in-app access points are:

- **Dashboard** for the public front door
- **Wiki** for handbook-style product and access documentation
- **Agent** for account-aware questions and confirmation-gated action staging

On mobile, the bottom navigation keeps the Agent tab available for chat while the top-bar help entry takes you to the wiki.

## CLI access

CLI access uses a user API token created from your own profile page.

The normal flow is:

1. Open your own profile.
2. Create a CLI token from the CLI Access card.
3. Authenticate from a terminal:

```bash
sportfolio auth login --token <your-token>
```

After that, the main command families are:

- `docs`
- `agent`
- `portfolio`
- `actions`

## Repo-local CLI entrypoint

The CLI package in this repo is currently private. If you are working directly from this codebase, use the repo-local entrypoint:

```bash
node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>
```

That gives you the same CLI command surface without requiring a published npm package.

## SMS access

SMS access starts from the profile phone-link flow or by texting from an unlinked number.

Once linked, SMS can use the same user-scoped agent context as the web flow, but it still follows the same confirmation-first safety model.

## MCP status

Sportfolio now exposes a public authenticated MCP endpoint at `/mcp`.

Use MCP when you want to connect Sportfolio to an MCP-aware client instead of using the web app or CLI directly.

Authentication uses the same user API tokens used by CLI access. Send the token as a bearer token to:

- `https://www.sportfolio.market/mcp` in production
- `http://127.0.0.1:5000/mcp` in local development

The public MCP v1 surface is intentionally scoped:

- gameplay and account reads are included
- docs resources and prompts are included
- state-changing gameplay flows are staged first and still require explicit confirmation
- billing, funding, bootstrap/token-management, SMS linking/settings, profile identity edits, agent settings/BYOK, and admin/internal routes are excluded

Read [MCP Access](/wiki/getting-started/mcp-access) for the exact endpoint contract, public surface, and exclusions.
