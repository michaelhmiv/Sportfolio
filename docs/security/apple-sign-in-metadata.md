# Apple Sign In Metadata — Retired

Last reviewed: 2026-08-11
Status: retired
Owner: Sportfolio Auth

## Current State

Sportfolio no longer uses the former Supabase-backed Sign in with Apple configuration described by earlier versions of this document.

Current public authentication is Sportfolio-owned passwordless email sign-in. Native iOS authentication uses the one-time email flow and the `sportfolio://auth/callback` handoff implemented by the current native-auth stack.

Do not use this document as an instruction to restore Supabase, Apple OAuth credentials, an Apple Services ID, or a Sign in with Apple provider. Those components are not part of the current public authentication architecture.

## App Store Implication

The current iOS release should be reviewed and tested against the passwordless email flow documented in:

- `docs/ios-publish-readiness-v1-checklist.md`
- `docs/ios-readiness-audit.md`
- `mobile/ios/App/fastlane/metadata/review_information/notes.txt`

If Sportfolio intentionally adds a qualifying third-party/social login method in the future, reevaluate Apple's current login-service requirements at that time and create new configuration documentation from the then-current implementation.

## Secret Policy

Do not commit Apple private keys (`.p8`), generated OAuth client secrets, App Store Connect private keys, signing certificate passwords, magic-link tokens, or other authentication credentials to this repository.
