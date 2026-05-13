---
title: Sportfolio iPhone Readiness Audit
summary: Current state of the Capacitor iOS shell, what is testable now on iPhone, and the remaining Apple-specific platform gaps.
status: draft
owner: product-engineering
lastReviewedAt: 2026-05-13
---

# Sportfolio iPhone Readiness Audit

## Summary

Sportfolio already has a real Capacitor iOS app shell checked into the repo under `mobile/ios`. This is not a greenfield Apple app effort. The current iPhone app is best understood as a native shell around the existing React product, with several native integrations already wired.

The main readiness risks are not around app existence. They are around platform parity. Core product navigation and account flows are largely positioned to work in an iPhone shell, but several mobile monetization and notification flows remain Android-only today.

## Source Of Truth Reviewed

- `capacitor.config.ts`
- `mobile/README.md`
- `mobile/ios/App/App.xcodeproj/project.pbxproj`
- `mobile/ios/App/App/Info.plist`
- `mobile/ios/App/App/AppDelegate.swift`
- `scripts/mobile-ios-doctor.mjs`
- `.github/workflows/ios-pr-ci.yml`
- `client/src/App.tsx`
- `client/src/lib/native-runtime.ts`
- `client/src/lib/native-platform.ts`
- `client/src/lib/native-network.ts`
- `client/src/lib/native-share.ts`
- `client/src/lib/haptics.ts`
- `client/src/components/mobile-push-manager.tsx`
- `client/src/components/mobile-push-card.tsx`
- `client/src/lib/mobile-push.ts`
- `client/src/pages/premium.tsx`
- `client/src/hooks/use-rewarded-scout-boost.ts`
- `server/routes/mobile-push-notifications.ts`

## Confirmed Native iOS Foundation

- Capacitor is configured with an iOS target at `mobile/ios`.
- A checked-in Xcode project exists at `mobile/ios/App/App.xcodeproj`.
- The app has a launch screen, app icon assets, and native app delegate.
- OAuth deep linking is already wired around `sportfolio://auth/callback`.
- The React app already branches for native runtime behavior and specifically handles iOS keyboard resizing.
- A macOS GitHub Actions workflow already runs iOS sync, doctor checks, and an unsigned simulator build.

## What Is Testable On iPhone Right Now

These areas appear positioned for real iPhone-shell testing once the app is synced and opened from macOS/Xcode:

- Auth callback and deep-link return flow.
- App shell startup, splash behavior, and status-bar management.
- Native-safe API and websocket routing through the shared runtime helpers.
- Core browsing and gameplay surfaces that are not Android-gated:
  - dashboard
  - player pages
  - portfolio
  - boosts
  - leaderboards
  - news
  - watchlists
- Native haptics wrapper behavior.
- Native share-sheet behavior.
- Offline/network-state handling through Capacitor network APIs.
- Route transitions, bottom navigation, and safe-area-aware shell layout.

## Works Now In The Current Codebase

These areas already have repo evidence that they are intentionally supported in the iOS shell:

- Capacitor shell bootstrapping and iOS project structure.
- iOS local-dev server targeting via `CAP_SERVER_URL=http://localhost:5000`.
- Native auth URL-open handling in `client/src/App.tsx`.
- iOS status bar handling and keyboard resize behavior.
- Native share support through `@capacitor/share`.
- Native haptic support through `@capacitor/haptics`.
- Native network monitoring through `@capacitor/network`.
- CI guardrails for iOS sync and simulator build.

## Needs macOS And Xcode, Not New Product Code

These are blocked by Apple tooling or host OS, not by missing repo architecture:

- Running `npm run mobile:ios` and opening the project in Xcode.
- Building the iOS app locally.
- Installing the native app to a connected iPhone.
- Signing the app with an Apple team/profile.
- Validating any device-only iOS behavior on real hardware.

This Windows environment can inspect, lint, and document the iOS app surface, but it cannot complete the real native build/install loop.

## Needs Actual Implementation

### Push notifications

Push exists in dependencies and the iOS Swift package includes the Capacitor push plugin, but the shipped product logic is still Android-specific:

- `client/src/lib/mobile-push.ts` exposes `isAndroidNativePushSupported()`.
- `client/src/components/mobile-push-manager.tsx` only registers and syncs Android pushes.
- `client/src/components/mobile-push-card.tsx` is explicitly labeled Android-only.
- `server/routes/mobile-push-notifications.ts` rejects non-Android registration with `Only android platform is supported`.

Implication:

- Apple push is not a finished product flow today, even if the lower-level plugin dependency is present.
- iOS support needs both client work and backend contract changes, plus Apple Push Notification capability setup.

### In-app purchases

Premium purchase flows are currently split between web checkout and Android Play Billing:

- `client/src/pages/premium.tsx` only shows native purchase/restore flows on Android.
- The native billing library is `client/src/lib/android-play-billing.ts`.
- Backend verification is Google Play specific.

Implication:

- There is no Apple in-app purchase path in the repo today.
- Shipping a true iPhone app with native premium purchasing would require StoreKit/App Store purchase implementation and corresponding backend verification logic.

### Rewarded ads

Rewarded scout boosts are explicitly Android-only today:

- `client/src/hooks/use-rewarded-scout-boost.ts` throws if not on Android.
- The UX and availability logic assume Android runtime support.

Implication:

- This feature would need an Apple-specific ads decision:
  - implement an iOS ad path,
  - replace the feature on iPhone,
  - or hide it entirely on Apple builds.

## Current iOS Gaps In Native Project Configuration

The current repo does not yet show evidence of several Apple-specific capabilities:

- No generated `mobile/ios/App/App/capacitor.config.json` is present in this worktree before sync.
- `npm run mobile:ios:doctor` currently fails because that generated file is missing.
- No iOS entitlements file is checked in.
- No `aps-environment` entitlement is visible.
- No Associated Domains capability is visible.
- No StoreKit or Apple purchase-specific native code is visible.
- The Xcode project currently uses `PRODUCT_BUNDLE_IDENTIFIER = com.sportfolio.app`, while Capacitor app identity is `sportfolio.market`.
- No Apple signing team is committed in project config, which is normal for shared repos but still means real device build setup remains open.

## Current Audit Split

### Works now in iPhone shell

- Capacitor iOS shell exists.
- Native auth callback handling exists.
- Native layout/runtime helpers exist.
- Core non-Android-gated product pages should be testable in a synced iOS shell.
- Native sharing, haptics, keyboard resizing, and network monitoring are already wired.

### Needs macOS/Xcode only

- Syncing and generating iOS native config for this worktree.
- Opening/building the app in Xcode.
- Running the app on a connected iPhone.
- Provisioning/signing and Apple developer configuration.

### Needs implementation

- iOS push registration, permission UX, backend acceptance, and APNs capability setup.
- Apple in-app purchases for premium/native monetization.
- iOS equivalent for rewarded ads, or explicit feature removal/hiding.
- Final bundle-id/signing/product identity alignment for App Store submission.

## Current Command Findings

### `npm run mobile:ios:doctor`

Observed result in this worktree:

- Pass: required Xcode project files exist.
- Pass: `Info.plist` contains the `sportfolio` URL scheme.
- Pass: `client/src/App.tsx` still handles auth callback deep links.
- Fail: `mobile/ios/App/App/capacitor.config.json` is missing.
- Warn: Xcode validation cannot run on Windows.

Interpretation:

- The native project is present and structurally valid.
- This checkout has not yet been freshly synced for iOS.
- The current blocker is expected for a Windows audit pass and does not indicate that the iOS app is absent.

## Recommended Next Steps

### Phase 1: First usable iPhone shell

- Sync the app on a macOS machine with `npm run mobile:sync:ios:dev` or `npm run mobile:sync:prod`.
- Open in Xcode and validate launch, sign-in, deep-link return, browsing, websocket updates, share, and haptics on a real iPhone.
- Fix any shell-specific layout or safe-area regressions found on actual hardware.

### Phase 2: Apple product boundary decisions

- Decide whether the first iPhone release should:
  - ship without push and native purchases,
  - ship with web-only premium purchase fallback,
  - or wait for Apple-native purchase/push support.
- Decide whether rewarded ads should be implemented for iOS, replaced with a different entitlement path, or hidden.

### Phase 3: Apple-native parity work

- Add iOS push lifecycle support and backend acceptance.
- Add Apple in-app purchase flow and backend verification.
- Align bundle identifier, signing, and App Store metadata.
- Add iPhone QA coverage to the release checklist once real device testing is available.

## Bottom Line

Sportfolio is not starting from zero on Apple. The repo already contains a real iOS app shell with meaningful native integration work behind it.

The shortest path to an Apple app is to treat the current iOS shell as an MVP wrapper for the existing product, then deliberately close the remaining Apple-specific product gaps. The most important missing pieces are push, native purchases, rewarded-ad strategy, and final Apple project configuration on a macOS/Xcode machine.
