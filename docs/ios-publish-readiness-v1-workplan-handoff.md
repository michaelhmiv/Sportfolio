# Apple Publish Readiness v1 Workplan Handoff — Superseded

Last reviewed: 2026-08-11
Status: superseded

This May 2026 implementation handoff is retained only as a pointer. Its prior details about Supabase, Sign in with Apple, missing iOS rewarded ads, detached worktrees, and incomplete validation no longer describe the current Sportfolio application.

Use these documents as the current source of truth:

- `docs/ios-readiness-audit.md` — current iOS/App Store architecture and readiness state
- `docs/ios-publish-readiness-v1-checklist.md` — operational release checklist
- `mobile/README.md` — mobile build/run commands
- `mobile/ios/App/fastlane/metadata/review_information/notes.txt` — current App Review notes
- `mobile/ios/app-store-submission-defaults.json` — automated App Store content-rights/age-rating declarations plus manual age-rating gates

Current authentication is Sportfolio-owned passwordless email sign-in with native callback handoff. Current iOS rewarded ads are implemented. App Store release automation now includes expanded iOS CI, privacy-manifest validation, strict listing precheck, App Review contact requirements, and explicit manual gates for App Privacy, age rating, review access, and accessibility.
