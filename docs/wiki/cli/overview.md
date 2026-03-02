---
id: cli-overview
title: Sportfolio CLI
summary: Install, authenticate, and use the Sportfolio CLI for docs, portfolio reads, and confirmation-gated operator workflows.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: packages/sportfolio-cli,server/routes/cli.ts,server/api-token-auth.ts
slug: overview
surface: web,cli
searchKeywords: cli,api token,terminal,auth,actions
---

# What the CLI is for

The Sportfolio CLI gives you a terminal-native way to read docs, inspect your account, and use the agent without opening the web app.

# Authentication model

CLI access uses user-scoped API tokens. Create a token from your profile page, then authenticate from a terminal:

```bash
sportfolio auth login --token <your-token>
```

# What the first version supports

- `docs list`, `docs search`, `docs open`
- `portfolio summary`
- `agent ask`, `agent threads`, `agent confirm`, `agent cancel`
- structured action staging through `actions ...` commands

# Safety model

The CLI does not bypass confirmation-gated state changes. Mutating flows still stage a plan first, then require a confirm step.

# Good operational hygiene

- use one token per device or automation task
- revoke tokens you no longer use
- avoid storing tokens in plain shell history
- prefer HTTPS endpoints outside localhost development
