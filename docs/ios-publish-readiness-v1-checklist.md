# iOS Publish Readiness Checklist (v1: iPhone + US)

Last reviewed: 2026-08-24

Launch scope:

- iPhone-only binary support
- US-only storefront for first submission
- Paid premium purchases disabled on iOS
- Rewarded Google Mobile Ads scout boost enabled with non-personalized requests
- In-app account deletion initiation available
- Better Auth passwordless email authentication with native handoff; no third-party social login is active

## Code / Repo Gates

- `mobile/ios/App/App.xcodeproj/project.pbxproj` uses `TARGETED_DEVICE_FAMILY = 1`.
- Native passwordless sign-in uses Better Auth email authentication and the `sportfolio://auth/callback` handoff.
- iOS profile picture flow remains library-only unless native camera behavior is intentionally re-reviewed.
- Account deletion endpoints and the in-app deletion flow remain available.
- Rewarded scout boosts support the native iOS adapter and use non-personalized ad requests.
- The Support page exposes `Report an ad` for inappropriate or age-inappropriate rewarded ads.
- Rewarded-ad reports can include the latest available ad response identifier and mediation adapter context.
- iOS external checkout and external purchase-sync controls for digital goods remain unavailable.
- `npm run mobile:ios:doctor` passes after a production iOS sync.
- `bash scripts/mobile-ios-privacy-manifest-audit.sh` passes after an iOS build.

## Authentication Review Path

Sportfolio currently uses Better Auth passwordless email backed by Railway PostgreSQL. Sign in with Apple and Supabase authentication are not active production providers.

Before every App Review submission:

1. Request a passwordless email sign-in link from a fresh email address that the tester can access.
2. Open the one-time link and confirm the native app receives the `sportfolio://auth/callback` handoff.
3. Confirm a new account can be created during review without staff intervention.
4. Confirm sign-out and a second sign-in work.
5. Confirm the production backend at `https://www.sportfolio.market` is healthy.

Do not reintroduce the retired Supabase or Sign in with Apple configuration unless a future architecture change explicitly requires and approves it.

## Apple Developer / Toolchain

- Use the current App Store-supported Xcode toolchain for uploads.
- Keep the App Store distribution certificate and `com.sportfoliomarket.app` provisioning profile valid.
- The TestFlight workflow verifies that the provisioning profile bundle ID matches the expected app identifier.

## App Store Connect Manual Gates

Before running the App Store release workflow, confirm all workflow gates explicitly:

1. **App Privacy**
   - Reconcile the App Privacy questionnaire with the current privacy policy and final Xcode privacy report.
   - Include applicable data practices from Google Mobile Ads/User Messaging Platform and other integrated SDKs.
   - Do not declare cross-app tracking unless the submitted build actually performs tracking that requires ATT.
2. **Age Rating**
   - `Advertising = Yes` because the iOS app contains optional rewarded video ads.
   - `Gambling = No` and `Simulated Gambling = None` for the current virtual-currency game.
   - Reconfirm the July 2026 Social Media capability questions manually in App Store Connect. The committed default is `Social Media = No` because Sportfolio does not provide a social feed or controls to repost, like, comment on, react to, or amplify user content.
3. **Accessibility Nutrition Label**
   - Reconfirm the current answers in App Store Connect against the submitted build.
4. **Review Access**
   - Verify Better Auth passwordless sign-in/new-account access using an email address the reviewer can access.
   - Verify the production backend is healthy.
5. **App Review Contact Information**
   - Configure these GitHub secrets before the listing workflow can upload review information:
     - `APP_STORE_REVIEW_CONTACT_FIRST_NAME`
     - `APP_STORE_REVIEW_CONTACT_LAST_NAME`
     - `APP_STORE_REVIEW_CONTACT_EMAIL`
     - `APP_STORE_REVIEW_CONTACT_PHONE`
6. **Screenshots / Availability**
   - Keep first-launch availability to the intended US storefront scope.
   - Upload only screenshot sets supported by the submitted iPhone device family.

## App Review Notes

The committed notes under `mobile/ios/App/fastlane/metadata/review_information/notes.txt` must remain factual for the submitted version. They should cover:

- virtual currency only; no real-money wagering, cash-out, or redeemable prizes;
- passwordless email sign-in and new-account review access;
- core Market, Portfolio, Scouts, Boosts, Leaderboards, and Watchlists review path;
- optional rewarded ads and the `Support > Report an ad` path;
- account deletion;
- iOS commerce boundary (no external checkout/purchase sync);
- relevant native integrations.

Do not include future-tense language such as “being finalized,” “coming soon,” or other statements that advertise unfinished functionality.

## Rewarded Advertising / AdMob

1. Configure the iOS AdMob app ID and rewarded ad unit.
2. Keep the SSV callback target at the production rewarded-scout endpoint.
3. Keep non-personalized request mode enabled for the current rewarded flow.
4. Test both successful reward completion and early ad dismissal.
5. Test `Support > Report an ad` after viewing an ad and confirm the generated report includes available diagnostic identifiers.
6. Reconcile Google Mobile Ads/User Messaging Platform behavior with App Privacy and the privacy policy before review.

## CI / Release Sequence

1. Require the current iOS App Review CI checks for any `client/src/**`, iOS, native-auth, or rewarded-ad-impacting change.
2. iOS CI must sync the production Capacitor shell, pass the App Store readiness doctor and iOS-specific tests, build the simulator app, and validate required privacy manifests.
3. Run `iOS Simulator Review` against `https://www.sportfolio.market` and inspect screenshots/logs.
4. Run `iOS TestFlight Release` with upload disabled for a signed archive dry run. The Fastlane lane blocks before upload if the privacy-manifest audit fails.
5. Run `iOS TestFlight Release` with upload enabled to upload the exact current `main` candidate.
6. Confirm the processed build appears in TestFlight and smoke-test it.
7. Run `iOS App Store Release` only after all manual confirmation inputs are true. The workflow uploads metadata, screenshots, declarations, and App Review information but intentionally does not submit for review.
8. In App Store Connect, select the tested processed build, review the final App Privacy/Age Rating/Accessibility/Review Information values, and submit that build for Apple review.

## Validation Commands

From repo root:

1. `npm run check`
2. `npm run lint`
3. `npm run test:run`
4. `npm run format:check`
5. `CAP_SERVER_URL=https://www.sportfolio.market npm run mobile:sync:ios`
6. `npm run mobile:ios:doctor`
7. `bash scripts/mobile-ios-privacy-manifest-audit.sh` (after an iOS build on macOS)
