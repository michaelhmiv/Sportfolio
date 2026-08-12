---
title: Sportfolio iPhone Readiness Audit
summary: Current App Store readiness state for the Sportfolio Capacitor iOS app and its release automation.
status: active
owner: product-engineering
lastReviewedAt: 2026-08-11
---

# Sportfolio iPhone Readiness Audit

## Current Assessment

Sportfolio has a functional Capacitor iOS application, signed-build/TestFlight automation, App Store listing automation, native rewarded ads, native passwordless authentication handoff, account deletion, profile-safety controls, and App Review metadata in the repository.

The iOS release path is no longer a greenfield or platform-parity project. The main release risk is keeping the live web-backed application, App Store declarations, third-party privacy disclosures, review access, and generated listing synchronized at the exact moment a build is submitted.

## Proven Release Infrastructure

- The iOS project is checked in under `mobile/ios/App`.
- The production App Store bundle identifier is `com.sportfoliomarket.app`.
- GitHub Actions can build a signed App Store IPA and upload it to App Store Connect/TestFlight.
- A prior recovery build, `2026.6.3 (400019)`, successfully archived, uploaded, and completed App Store Connect processing on 2026-06-03.
- The App Store listing workflow subsequently completed successfully on `main` on 2026-06-05.
- Current workflows use the latest stable Xcode runner; the iOS doctor enforces Xcode 26+ on macOS.

## Current Runtime Architecture

Sportfolio's native shell loads the configured hosted application URL. Production release workflows use:

- `https://www.sportfolio.market`

Because most of the product experience is delivered by the hosted React application, a previously processed binary is not sufficient evidence that the current reviewer experience is healthy. Material client/runtime changes must trigger iOS CI, and a fresh simulator/TestFlight smoke test is required before submission.

## Authentication

Current authentication is Sportfolio-owned passwordless email sign-in, not the old Supabase/Apple OAuth design.

Native flow:

1. User requests a one-time email sign-in link.
2. Sportfolio sends the link through the current auth/mail stack.
3. The native app receives the `sportfolio://auth/callback` handoff.
4. The handoff is exchanged for the native Sportfolio session.

The old documentation requiring Supabase configuration and Sign in with Apple has been retired. Review readiness now depends on verifying that a reviewer-controlled email can create/sign in to an account and complete the callback flow against production.

## Rewarded Advertising

Native iOS rewarded scout boosts are implemented through Google Mobile Ads.

Current release contract:

- rewarded ads are optional;
- requests use the current non-personalized mode;
- rewards affect virtual gameplay only;
- App Store age-rating automation declares `Advertising = Yes`;
- the privacy policy explicitly describes rewarded advertising and related provider processing;
- the Support page provides `Report an ad` for inappropriate or age-inappropriate ads;
- the app retains limited recent ad diagnostic context on-device so a report can identify the relevant response/network adapter when available.

## Public Profile Content / UGC

Sportfolio exposes user-selected public profile elements, including usernames and profile images, so the App Store age-rating declaration now sets `userGeneratedContent: true`.

Signed-in users can:

- report objectionable profile content for moderation review;
- block another user's public profile from their own account;
- unblock that profile later.

Profile reports persist the reporting user, reported account, reason/details, and a snapshot of the reported username/profile-image reference. Blocks are persisted and the public-profile endpoint hides a blocked user's profile content from the blocker.

## App Store Age Rating

Committed automated declarations live at:

- `mobile/ios/app-store-submission-defaults.json`

Current automated values intentionally include:

- `advertising: true`
- `userGeneratedContent: true`
- `gambling: false`
- `gamblingSimulated: NONE`

Apple added Social Media capability questions to the age-rating questionnaire in July 2026. The current App Store Connect API `ageRatingDeclaration` surface used by Sportfolio does not automate that new field, so the repository explicitly records the intended manual answer and the listing workflow requires a manual age-rating confirmation before it can run.

Current intended Social Media answer is `No`: Sportfolio does not provide a social feed or controls to repost, like, comment on, react to, or amplify user content. Reconfirm the live questionnaire before review.

## App Review Information

Fastlane now requires App Review contact information rather than silently skipping it. Required GitHub secrets:

- `APP_STORE_REVIEW_CONTACT_FIRST_NAME`
- `APP_STORE_REVIEW_CONTACT_LAST_NAME`
- `APP_STORE_REVIEW_CONTACT_EMAIL`
- `APP_STORE_REVIEW_CONTACT_PHONE`

The committed review notes describe only current behavior: virtual currency, passwordless review access, core gameplay, rewarded ads/reporting, public-profile safety controls, account deletion, the iOS commerce boundary, and native integrations. Future-tense statements about unfinished IAP work are prohibited by the iOS doctor.

## Privacy Manifest / SDK Gate

The repository does not invent an app-level `PrivacyInfo.xcprivacy` declaration without evidence. Instead, macOS CI scans dependency and Xcode build products for actual privacy manifests, validates each plist, and requires identifiable Capacitor and Cordova manifests because Apple lists those SDKs among commonly used SDKs subject to privacy-manifest/signature requirements.

The audit also reports whether Google Mobile Ads/User Messaging Platform manifests are identifiable and requires the final Xcode privacy report to be reconciled with App Store Connect App Privacy answers before review.

## CI Coverage

`iOS App Review CI` is the active macOS/Xcode review gate. It triggers for the full `client/src/**` surface, relevant shared/native-auth/profile-safety/rewarded-ad backend code, migrations, iOS workflows, App Store scripts, and iOS documentation.

The iOS review job performs:

1. current Xcode selection/version verification;
2. dependency install;
3. production Capacitor iOS sync;
4. expanded iOS/App Store readiness doctor;
5. iOS-specific rewarded-ad/reporting tests;
6. unsigned simulator build;
7. privacy-manifest audit.

Repository-wide Code Validation also enforces Prettier formatting for the release-hardening changes before merge.

The signed TestFlight lane performs the privacy-manifest audit after the App Store archive is built and before any TestFlight upload.

## Listing Workflow Safety Gates

`iOS App Store Listing` intentionally does not submit the app for review. Before it can update App Store Connect, it now requires explicit confirmation that the operator has reviewed:

- App Privacy;
- the current age-rating questionnaire, including Advertising, UGC, and the July 2026 Social Media questions;
- passwordless reviewer access and production-backend health;
- the Accessibility Nutrition Label.

It also requires App Store Connect API credentials and all App Review contact secrets.

The workflow runs the repository readiness doctor before applying App Store declaration API writes, then builds the simulator app, audits privacy manifests, captures screenshots, and uploads metadata/review information/screenshots with Fastlane precheck violations treated as errors.

## Remaining App Store Connect-Only Steps

These cannot be truthfully certified from repository state alone and remain final release actions:

1. Confirm App Privacy answers match the final build/Xcode privacy report.
2. Confirm the current age-rating questionnaire, including UGC and the new Social Media fields.
3. Confirm Accessibility Nutrition Label answers.
4. Confirm App Review contact information and reviewer access.
5. Confirm storefront availability and screenshot presentation.
6. Select the exact tested processed TestFlight build for the App Store version.
7. Check Resolution Center for unresolved Apple messages.
8. Submit the selected build for review.

## Release Sequence

Use `docs/ios-publish-readiness-v1-checklist.md` as the operational release checklist. The intended sequence is PR CI -> simulator QA -> signed TestFlight dry run -> current TestFlight upload -> listing workflow with manual confirmations -> final App Store Connect reconciliation -> submit for review.

## Bottom Line

The native build/signing/upload path is established. Current readiness work is primarily release governance: ensuring today's production experience is tested, declarations match actual app behavior, advertising/privacy/UGC requirements are represented accurately, and App Store Connect-only answers are explicitly reconfirmed immediately before submission.
