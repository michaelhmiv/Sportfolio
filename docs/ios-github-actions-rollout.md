---
title: iOS GitHub Actions Rollout
summary: How Sportfolio should use GitHub-hosted macOS runners for simulator QA now, and what still needs Apple signing and real-device access.
status: draft
owner: product-engineering
lastReviewedAt: 2026-05-13
---

# iOS GitHub Actions Rollout

## Goal

Use GitHub-hosted macOS runners immediately for repeatable iPhone-shell QA, while keeping a clear line between:

- simulator validation we can automate now,
- and Apple-only signing/device/App Store tasks that still require the normal Apple developer setup.

## What GitHub Actions Can Do For Us Now

- Sync the Capacitor iOS shell.
- Run iOS guardrail checks.
- Build the unsigned simulator app.
- Boot a hosted iPhone simulator on a macOS runner.
- Install the built app into the simulator.
- Launch the app and open deep links.
- Capture screenshots and upload them as workflow artifacts.

This is enough to catch:

- shell boot regressions,
- broken deep-link routing,
- major layout crashes,
- obvious runtime boot failures,
- and some first-screen navigation issues.

## What GitHub Actions Cannot Replace

- Real iPhone hardware testing.
- Xcode interactive debugging on a local Mac.
- Apple signing identity management without secrets and Apple Developer access.
- App Store Connect configuration.
- APNs device testing.
- StoreKit purchase testing on a real Apple app setup.

## New Workflow Added

- `.github/workflows/ios-simulator-qa.yml`

This workflow:

1. installs dependencies,
2. syncs Capacitor for iOS,
3. runs `mobile:ios:doctor`,
4. builds the simulator app,
5. boots an iPhone simulator on the GitHub macOS runner,
6. installs and launches the app,
7. opens a few core deep links,
8. uploads screenshots, logs, and DerivedData as artifacts.

## How To Run It

In GitHub:

1. Open `Actions`.
2. Select `iOS Simulator QA`.
3. Click `Run workflow`.
4. Leave `cap_server_url` as production for the safest first pass.
5. Leave `simulator_name` as `iPhone 16` unless the runner image changes.

## Expected Artifacts

Each run uploads:

- iOS build log
- DerivedData
- selected simulator metadata
- smoke summary JSON
- screenshots
- zipped `.app` bundle for the simulator build

## Recommended Immediate Usage

### First pass

- Run the workflow against `https://www.sportfolio.market`.
- Review whether the app launches and the screenshots reach:
  - home
  - portfolio
  - boosts
  - pools

### Second pass after iOS-specific fixes

- Re-run the same workflow before each PR merge that touches:
  - `client/src/App.tsx`
  - native runtime helpers
  - Capacitor config
  - `mobile/ios`
  - auth deep-link handling

## Next App Store / TestFlight Prerequisites

GitHub-hosted simulator QA is the first practical step, but App Store hookup still needs:

- a final production bundle identifier decision,
- Apple Developer team access,
- signing certificate export (`.p12`),
- provisioning profile,
- repository secrets for signing,
- App Store Connect app record,
- App Store Connect API key if we want CI-driven uploads,
- real-device validation on a Mac with Xcode.

## Repository Secrets To Prepare Later

For CI signing, GitHub's Xcode signing guidance maps cleanly to these secret names:

- `BUILD_CERTIFICATE_BASE64`
- `P12_PASSWORD`
- `BUILD_PROVISION_PROFILE_BASE64`
- `KEYCHAIN_PASSWORD`

If we later automate TestFlight upload, we should also expect App Store Connect API credentials such as:

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_BASE64`

## Recommended Sequence

1. Use `iOS Simulator QA` now to harden shell launch and route behavior.
2. Fix any simulator-visible regressions first.
3. Move to a Mac for real iPhone install/signing.
4. Add signing secrets only after the bundle identifier and Apple team setup are settled.
5. Add a separate manual TestFlight workflow after signing inputs are confirmed.

## Bottom Line

GitHub Actions is useful right now for iPhone-app progress, but only for simulator QA and build confidence. It is not the final bridge to a real testable iPhone build by itself. The simulator workflow should be treated as the first gate, not the whole Apple release path.
