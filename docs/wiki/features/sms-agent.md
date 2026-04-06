---
id: feature-sms-agent
title: SMS Agent
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

# Legacy SMS reference

SMS is no longer part of the primary Hermes product contract.

This page remains as a legacy reference for the older SMS linking and concierge flow.

## The SMS channel was conversation-first

Sportfolio's SMS flow was designed so a user could start a conversation before they were fully linked. The system did not force an immediate hard signup wall just to ask a question.

That meant the SMS channel started as a lightweight concierge and became an authenticated operator only after secure linking.

## Before linking: guest concierge mode

Before a number was linked to an account, the SMS agent could still help with general discussion such as:

- explain shares, scouts, boosts, and other core mechanics
- talk through player and game concepts
- help a new user understand how Sportfolio works

Treat this as product guidance and onboarding by text, not as account access.

## When linking became required

The SMS agent would ask the user to link when they moved from general conversation into account-specific work.

Linking was required for anything tied to account state, including:

- portfolio-specific reads
- staging trades or other supported actions
- confirming a pending in-game action by text

In other words, explanation could start before identity. Execution could not.

## How linking worked

The linking flow was intentionally narrow:

1. You provided a phone number from the profile page or texted from an unknown number.
2. Sportfolio generated a one-time link token.
3. You opened the browser link while authenticated.
4. The phone number became attached to that account.

After that, the SMS channel could safely access the same user-scoped agent context as the web flow.

## What the linked SMS channel could do

Once linked, the SMS agent could:

- answer account-specific questions
- read supported account surfaces
- stage supported in-game actions
- accept explicit action confirmation by text

It still followed the same confirmation-first rules as the web and CLI agent.

## Safety boundary

SMS supported conversational guidance and supported in-game account actions after linking. Premium, billing, and purchase flows remained web-only.

That boundary existed to keep higher-risk account and payment workflows on richer, more explicit surfaces.

## Opt-out and channel hygiene

The SMS layer also supported standard opt-out keywords. Unknown numbers stayed in guest-concierge mode until they completed the link flow.

This kept the channel useful for quick conversation while still preserving identity and consent boundaries.
