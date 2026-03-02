---
id: internal-telnyx-sms-setup
title: Telnyx SMS Setup
summary: Internal setup reference for the Sportfolio Telnyx SMS channel.
audience: internal
category: internal
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: server/routes/sms.ts,server/sms-service.ts,server/services/telnyx-sms.ts,.env.example
slug: telnyx-sms-setup
surface: internal
searchKeywords: telnyx,sms,webhook,env,setup
---

# Required environment variables

- `TELNYX_API_KEY`
- `TELNYX_PUBLIC_KEY` (raw base64 Ed25519 key from Telnyx or PEM public key)
- `TELNYX_FROM_NUMBER` or `TELNYX_MESSAGING_PROFILE_ID`
- `SMS_LINK_SECRET` (recommended) or `USER_AGENT_SECRET_KEY`
- `PUBLIC_SITE_URL`

# Webhook endpoints

- `POST /api/webhooks/telnyx/sms`
- `POST /api/webhooks/telnyx/sms/status`

Both routes require a valid Telnyx Ed25519 signature using the `telnyx-signature-ed25519` and `telnyx-timestamp` headers.
Sportfolio acknowledges these webhook requests immediately, then processes the agent work in the background to reduce duplicate retries.

# Linking flow

1. User enters a phone number from the profile page or texts from an unknown number.
2. Sportfolio creates a single-use token and sends a browser link.
3. The user completes linking at `/sms/link?token=...` while authenticated.
4. After linking, the phone number can be used for account-specific agent reads and supported in-game action confirmation.

# Safety notes

- Unknown numbers only get guest concierge guidance plus a link handoff.
- `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, and `QUIT` opt the number out.
- Premium, billing, and purchase-like flows remain blocked from SMS.
