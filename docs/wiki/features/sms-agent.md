---
id: feature-sms-agent
title: SMS Agent
summary: How the SMS channel works from first contact through account linking, what it can do by text, and what remains web-only.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: server/sms-service.ts,server/routes/sms.ts,server/services/telnyx-sms.ts,client/src/components/sms-access-card.tsx,client/src/pages/sms-link.tsx
slug: sms-agent
surface: web,agent
searchKeywords: sms,text,telnyx,phone link,guest concierge,linked account
---

# The SMS channel is conversation-first

Sportfolio's SMS flow is designed so a user can start a conversation before they are fully linked. The system does not force an immediate hard signup wall just to ask a question.

That means the SMS channel starts as a lightweight concierge and becomes an authenticated operator only after secure linking.

## Before linking: guest concierge mode

Before your number is linked to an account, the SMS agent can still help with general discussion such as:

- explain shares, scouts, boosts, and other core mechanics
- talk through player and game concepts
- help a new user understand how Sportfolio works

Treat this as product guidance and onboarding by text, not as account access.

## When linking becomes required

The SMS agent will ask you to link when you move from general conversation into account-specific work.

Linking is required for anything tied to your account state, including:

- portfolio-specific reads
- staging trades or other supported actions
- confirming a pending in-game action by text

In other words, explanation can start before identity. Execution cannot.

## How linking works

The linking flow is intentionally narrow:

1. You provide a phone number from the profile page or text from an unknown number.
2. Sportfolio generates a one-time link token.
3. You open the browser link while authenticated.
4. The phone number becomes attached to that account.

After that, the SMS channel can safely access the same user-scoped agent context as the web flow.

## What the linked SMS channel can do

Once linked, the SMS agent can:

- answer account-specific questions
- read supported account surfaces
- stage supported in-game actions
- accept explicit action confirmation by text

It still follows the same confirmation-first rules as the web and CLI agent.

## Safety boundary

SMS supports conversational guidance and supported in-game account actions after linking. Premium, billing, and purchase flows remain web-only.

That boundary exists to keep higher-risk account and payment workflows on richer, more explicit surfaces.

## Opt-out and channel hygiene

The SMS layer also supports standard opt-out keywords. Unknown numbers stay in guest-concierge mode until they complete the link flow.

This keeps the channel useful for quick conversation while still preserving identity and consent boundaries.
