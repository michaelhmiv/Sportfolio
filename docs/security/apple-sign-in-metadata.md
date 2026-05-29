# Apple Sign In Metadata (Non-Secret)

Last updated: 2026-05-28
Owner: Sportfolio iOS/Auth

## Purpose

This document tracks non-secret Apple Sign in configuration values used by Sportfolio.
Do not store private key files (`.p8`) or generated Apple client secrets in this repository.

## Current Configuration

- Apple Team ID: `R42LWFBXBH`
- Apple Services ID (Client ID): `com.sportfolio.auth`
- Active Apple Key ID: `T46N2W9CLV`
- Supabase Project Ref: `xolfyrbtkmwgllrazcfh`
- Supabase Callback URL: `https://xolfyrbtkmwgllrazcfh.supabase.co/auth/v1/callback`
- Supabase Domain (for Apple Services ID): `xolfyrbtkmwgllrazcfh.supabase.co`

## Rotation / Maintenance

- Apple OAuth client secret expires every 6 months for OAuth-based Sign in with Apple.
- Create a calendar reminder at least 2 weeks before expiration to rotate:
  - Apple Sign in key (`.p8`) if needed
  - Supabase Apple provider client secret (JWT)
- After rotation, verify login using a private/incognito browser session.

## Storage Policy

- Keep `.p8` files in a secure secret manager or encrypted vault.
- Keep generated client secrets in secret stores only (not Git, not docs, not issue comments).
