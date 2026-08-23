# iOS Publish Readiness Checklist (v1: iPhone + US)

Launch scope (decision-locked):

- iPhone only binary support
- US-only storefront at first submission
- Paid premium purchases disabled on iOS
- Rewarded AdMob scout boost enabled (non-personalized requests)
- In-app account deletion initiation available
- Better Auth passwordless web/native handoff included

## Code/Repo Checks

- `mobile/ios/App/App.xcodeproj/project.pbxproj` uses `TARGETED_DEVICE_FAMILY = 1`
- Login supports Better Auth passwordless email in `client/src/hooks/useAuth.tsx` and `client/src/pages/Login.tsx`
- iOS profile picture flow uses library-only upload and does not expose a `capture="user"` camera path
- Account deletion APIs exist:
  - `GET /api/account/deletion/status`
  - `POST /api/account/deletion/request`
  - `POST /api/account/deletion/cancel`
- Account deletion processor starts at server boot (`server/index.ts`)
- Rewarded scout boosts support native iOS + Android adapter path
- iOS external premium checkout remains blocked

## Better Auth / Railway Setup

1. Configure the production Railway service with `BETTER_AUTH_URL=https://www.sportfolio.market`.
2. Enable `AUTH_MAGIC_LINK_ENABLED=true` and `AUTH_NATIVE_HANDOFF_ENABLED=true` when the
   passwordless native flow is included in the release.
3. Configure `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `AUTH_EMAIL_FROM` in Railway; keep
   all credentials out of the repository.
4. Confirm the native callback `/auth/native/complete` and native auth exchange routes work
   against the Railway PostgreSQL-backed Better Auth deployment.

## Apple Developer + App Store Connect

1. Apple Developer:
   - Enable `Sign in with Apple` capability on the app identifier.
   - Ensure signing certificates/profiles are valid for TestFlight/App Store.
2. App Store Connect:
   - Keep availability to `United States` only for first launch.
   - Complete App Privacy and Accessibility Nutrition Label sections.
   - Reconfirm age rating responses and keep simulated gambling at `NONE` for this virtual-currency build.
   - Add review notes with test credentials and sign-in/deletion/rewarded-ad steps.
   - Upload iPhone screenshot sets only.

## AdMob Setup

1. Configure app IDs:
   - Android: `ADMOB_APP_ID_ANDROID`
   - iOS: `ADMOB_APP_ID_IOS`
2. Configure rewarded ad units:
   - `ADMOB_REWARDED_SCOUT_AD_UNIT_ID_ANDROID`
   - `ADMOB_REWARDED_SCOUT_AD_UNIT_ID_IOS`
3. Keep SSV callback target:
   - `https://www.sportfolio.market/api/mobile/rewarded-scout-boost/admob/ssv`
4. Ensure non-personalized ad request mode remains enabled for the rewarded flow.

## CI / Release

1. Run `iOS App Store Listing` on `main` and verify metadata/screenshots sync.
2. Run `iOS TestFlight` with `skip_upload=true`, then `skip_upload=false`.
3. Validate build appears in TestFlight and submit the tested build to review.

## Validation Commands

Run from repo root:

1. `npm run check`
2. `npm run lint`
3. `npm run test:run`
4. `npm run format:check`
