# Resend magic-link delivery

Sportfolio sends only transactional authentication email through Resend. Delivery remains disabled until `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `AUTH_EMAIL_FROM`, and `AUTH_MAGIC_LINK_ENABLED=true` are configured in Railway.

Security properties:

- Better Auth stores hashed, single-use tokens with a five-minute expiry.
- Generated links and callback URLs are restricted to the configured Sportfolio origins.
- Email sends use a token-derived idempotency key; the raw token is never logged.
- Per-email, per-IP, and global fixed-window limits protect the request path.
- Suppressed recipients receive an enumeration-resistant accepted response without another delivery attempt.
- The webhook verifies the raw payload and Svix headers before processing.
- Webhook events are idempotent by `svix-id`; routine email addresses are stored only as SHA-256 identity hashes.
- Permanent bounces, spam complaints, and provider suppressions create local suppression records.

The webhook endpoint is `/api/webhooks/resend`. Configure it for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed` after the sending domain is verified.

Merging this implementation does not activate email delivery. Both application services remain on Supabase authentication until the shared-database migration, Resend credentials, verified sending domain, webhook secret, and dual-auth validation are complete.
