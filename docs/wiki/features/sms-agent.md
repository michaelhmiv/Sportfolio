---
id: feature-sms-agent
title: SMS Agent
summary: How the Sportfolio SMS agent works, what it can discuss before linking, and where account linking is required.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: server/sms-service.ts,server/routes/sms.ts,server/services/telnyx-sms.ts,client/src/components/sms-access-card.tsx,client/src/pages/sms-link.tsx
slug: sms-agent
surface: web,agent
searchKeywords: sms,text,telnyx,phone link,guest concierge
---

# Talk first, link when it matters

You can start texting the Sportfolio agent before your number is linked. The first goal is a natural sports-and-portfolio conversation, not a hard signup wall.

# What unlinked users can do

Before linking, the SMS agent can:

- explain shares, scouts, boosts, and vesting
- talk through player and game concepts
- help a new user understand how Sportfolio works

It will ask you to link an account only when you cross into account-specific reads or in-game actions.

# What requires linking

Linking is required for anything tied to your account state, including:

- portfolio-specific reads
- staging trades or other supported actions
- confirming a pending in-game action by text

# Safety boundary

SMS supports conversational guidance and supported in-game account actions after linking. Premium, billing, and purchase flows remain web-only.
