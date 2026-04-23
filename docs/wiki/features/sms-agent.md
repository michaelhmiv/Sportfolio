---
id: feature-sms-agent
title: SMS Agent (Legacy)
summary: Legacy reference for the SMS channel: how linking worked, what text flows supported, and what remained web-only.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: server/sms-service.ts,server/routes/sms.ts,server/services/telnyx-sms.ts,client/src/components/sms-access-card.tsx,client/src/pages/sms-link.tsx
slug: sms-agent
surface: web,agent
searchKeywords: sms,text,telnyx,phone link,guest concierge,linked account
---

# SMS Agent (Legacy)

> ⚠️ **SMS is no longer part of the primary Hermes product contract.** This page is a legacy reference for the older SMS linking and concierge flow. For current agent access, use the [web Agent page](/wiki/features/agent-operator) or [CLI](/wiki/cli/overview).

---

## How the SMS Channel Worked

The SMS flow was designed so a user could start a conversation before completing full account linking. No hard signup wall just to ask a question.

### Before Linking: Guest Concierge Mode

Before a phone number was linked to an account, the SMS agent could:
- Explain shares, scouts, boosts, and core mechanics
- Discuss player and game concepts
- Help new users understand how Sportfolio works

This was product guidance by text, not account access.

### When Linking Was Required

The agent prompted linking when the conversation moved from general explanation to account-specific work:
- Portfolio-specific reads
- Staging trades or in-game actions
- Confirming a pending action by text

In other words: **explanation before identity, execution never before identity.**

---

## How Linking Worked

1. User entered a phone number from their profile page (or texted from an unknown number)
2. Sportfolio generated a one-time link token and sent a browser link
3. User completed linking at `/sms/link?token=...` while authenticated
4. Phone number was attached to that account

After linking, the SMS channel could access the same user-scoped agent context as the web.

---

## What the Linked Channel Could Do

Once linked, the SMS agent could:
- Answer account-specific questions
- Read supported account surfaces
- Stage supported in-game actions
- Accept explicit action confirmation by text

It followed the same confirm-before-execute rules as the web and CLI agent.

---

## Safety Boundaries

- Premium, billing, and purchase flows were **always web-only**
- Unknown numbers stayed in guest-concierge mode until linking completed
- Standard opt-out keywords (`STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`) were supported

---

## Current Status

SMS is legacy infrastructure. The active agent contract uses:
- **Web Agent page** — primary conversational surface
- **Sportfolio CLI** — terminal access
- **Public MCP** — protocol access for external clients
