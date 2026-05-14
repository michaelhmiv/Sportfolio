---
title: iOS GitHub Actions Rollout
summary: How Sportfolio uses GitHub-hosted macOS runners for iOS simulator QA and manual TestFlight release automation.
status: draft
owner: product-engineering
lastReviewedAt: 2026-05-14
---

# iOS GitHub Actions Rollout

## Goal

Use GitHub-hosted macOS runners for two concrete iOS gates:

- repeatable simulator QA,
- and manual, controlled TestFlight uploads for signed release builds.

## What GitHub Actions Covers

- Sync the Capacitor iOS shell.
- Run iOS guardrail checks.
- Build unsigned simulator apps for smoke QA.
- Build signed release IPAs with imported signing assets.
- Upload signed release builds to TestFlight using App Store Connect API keys.

## What It Does Not Replace

- Real iPhone hardware testing.
- Xcode interactive debugging on a local Mac.
- Apple account onboarding tasks in the developer portals.
- Product decisions for iOS-only feature parity (for example push/IAP work).

## iOS Workflows In This Repo

- `.github/workflows/ios-pr-ci.yml`
- `.github/workflows/ios-simulator-qa.yml`
- `.github/workflows/ios-testflight.yml`

### `iOS PR CI`

PR guardrail for iOS-impacting code:

- syncs iOS shell,
- runs `mobile:ios:doctor`,
- builds unsigned simulator output.

### `iOS Simulator QA`

Manual simulator smoke run with screenshots/artifacts:

- syncs iOS shell,
- builds simulator app,
- boots hosted iPhone simulator,
- launches deep links and captures evidence.

### `iOS TestFlight`

Manual signed release workflow:

- syncs iOS shell with configurable `cap_server_url`,
- validates required signing and upload secrets,
- imports `.p12` and provisioning profile into temporary runner keychain/profile directories,
- computes deterministic iOS build number (`400000 + github.run_number`),
- builds signed IPA via fastlane lane `ios testflight_ci`,
- optionally uploads to TestFlight (`skip_upload=false`),
- always cleans up temporary signing material at workflow end.

## Required GitHub Secrets (`iOS TestFlight`)

Signing:

- `BUILD_CERTIFICATE_BASE64`
- `P12_PASSWORD`
- `BUILD_PROVISION_PROFILE_BASE64`
- `KEYCHAIN_PASSWORD`

Upload (required only when `skip_upload=false`):

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_BASE64`

## Windows-First Signing Bootstrap

If you do not have a Mac, this repo now includes helper scripts to prepare signing assets and secrets:

- `scripts/ios-signing-bootstrap.ps1`
  - Generates `ios_distribution.csr` + `ios_distribution.key` on Windows via OpenSSL.
  - Converts Apple-downloaded `.cer` to `.p12` using the generated private key.
- `scripts/ios-set-testflight-secrets.ps1`
  - Base64-encodes `.p12` / `.mobileprovision` / `.p8`.
  - Pushes all required GitHub repository secrets through `gh secret set`.

## iOS Release Preflight Checklist

Before running `iOS TestFlight`:

1. Confirm App Store Connect app record exists for `com.sportfoliomarket.app`.
2. Confirm the App Store provisioning profile is for `com.sportfoliomarket.app`.
3. Confirm the exported `.p12` contains the matching private key.
4. Confirm cert/profile are current (not expired/revoked).
5. Run `iOS Simulator QA` against `https://www.sportfolio.market` first.
6. First run `iOS TestFlight` with `skip_upload=true` to validate signing/archive path.

## App Review Hardening (Gambling + Payments)

Before the first TestFlight build intended for Apple review, verify:

1. iOS app does not expose external checkout CTAs for digital goods (`/api/premium/checkout-session`, `/api/community/checkout-session`, `/api/whop/sync` are blocked for iOS-native clients).
2. User-facing copy keeps gameplay framed as virtual-currency strategy play (no real-money betting or cash-out).
3. Terms/Help/Onboarding mention virtual currency, no cash-out, and no real-money gambling.
4. App Store Connect age-rating questionnaire is completed accurately; choose simulated-gambling descriptors that match observed gameplay and resulting Apple global age rating.
5. App Review notes include a short explanation of gameplay mechanics, virtual-currency boundaries, and exactly how reviewers can access core features.

### App Review Notes Template (Recommended)

Use this in App Store Connect "Notes for Review" and tailor specifics:

- Sportfolio is a virtual-currency sports strategy game. It does not offer real-money gambling, sports betting, or cash-out.
- Core loop: users trade virtual player shares, assign scouts, and use boost slots tied to live game performance.
- iOS build currently disables external checkout/purchase flows for digital goods while Apple IAP rollout is in progress.
- Reviewer access: provide active login credentials and any required test steps for portfolio, boosts, and scouting flows.
- Backend availability: `https://www.sportfolio.market` is live during review.

## Recommended Sequence

1. Use `iOS PR CI` and `iOS Simulator QA` to keep shell behavior stable.
2. Run `iOS TestFlight` with `skip_upload=true` after signing secrets are configured.
3. Run `iOS TestFlight` with `skip_upload=false` for the first real upload.
4. Confirm the build appears under App Store Connect TestFlight and assign testers.

## Bottom Line

GitHub Actions now covers both iOS simulator QA and manual TestFlight release automation for this repo. Real iPhone validation and Apple-side product readiness decisions still remain required before broader App Store rollout.
