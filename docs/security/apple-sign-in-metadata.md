# Apple Sign In Metadata (Archived)

Last updated: 2026-05-28
Owner: Sportfolio iOS/Auth

## Purpose

Sportfolio's active authentication path is Better Auth passwordless email with Railway
PostgreSQL. Sign in with Apple is not an active production provider. This file remains only as
an archival pointer for a future, separately approved provider integration.

Do not store private key files (`.p8`), client secrets, or provider credentials in this repository.

## Current Configuration

No Apple provider configuration is active in the current deployment. Any future Apple
configuration must be recorded in the approved secret/configuration system and wired through
Better Auth without reintroducing a retired provider or fallback.

## Rotation / Maintenance

- If Apple is approved in a future auth release, rotate its provider credentials through the
  approved secret manager and verify the Better Auth callback in a private browser session.

## Storage Policy

- Keep `.p8` files in a secure secret manager or encrypted vault.
- Keep generated client secrets in secret stores only (not Git, not docs, not issue comments).
