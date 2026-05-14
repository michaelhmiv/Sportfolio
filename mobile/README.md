# Mobile Build + Install Runbook

This project uses Capacitor with native projects in:

- `mobile/android`
- `mobile/ios`

Related audit:

- `docs/ios-readiness-audit.md` for the current iPhone-ready surface, tooling blockers, and Apple-specific implementation gaps.
- `docs/ios-github-actions-rollout.md` for the GitHub-hosted iOS simulator workflow and App Store/TestFlight prep sequence.

## Prerequisites

- Node.js + npm
- Java 21
- Android SDK + emulator tooling (`adb`, `sdkmanager`, `avdmanager`) in `PATH`
- Xcode (macOS only, for iOS)
- Firebase CLI (`firebase`)

## Required Environment Variables

At minimum:

- Web app env: copy `.env.example` to `.env` and configure the normal app requirements needed by `npm run dev` (same requirements as web development).
- `CAP_SERVER_URL` for native shell routing (optional, defaults to production URL when omitted).

Common `CAP_SERVER_URL` values:

- iOS local dev server: `http://localhost:5000`
- Android emulator local dev server: `http://10.0.2.2:5000`
- Production hosted app: `https://www.sportfolio.market`

## One-time Verification / Guardrails

```bash
npx cap doctor
npm run mobile:ios:doctor
firebase --version
firebase projects:list
npm run android:sdk:check
```

Confirm Firebase Android config matches app package:

- file: `mobile/android/app/google-services.json`
- expected package: `sportfolio.market`

## iOS Quickstart (Capacitor Shell)

### 1) Run the web app locally

```bash
npm run dev
```

Default local URL: `http://127.0.0.1:5000` (native iOS can use `http://localhost:5000`).

### 2) Sync iOS with explicit URL target

Local iOS dev target:

```bash
npm run mobile:sync:ios:dev
```

Production hosted target:

```bash
npm run mobile:sync:prod
```

Generic iOS sync (uses current `CAP_SERVER_URL` env or default production URL):

```bash
npm run mobile:sync:ios
```

### 3) Open in Xcode (macOS only)

```bash
npm run mobile:ios
```

### 4) Build iOS (macOS only)

```bash
npm run mobile:build:ios
```

The project uses `App.xcodeproj` (`mobile/ios/App/App.xcodeproj`).

### OAuth Deep Link

The native auth callback is:

- `sportfolio://auth/callback`

Configured in:

- iOS `Info.plist` URL types
- Client deep-link handling (`client/src/App.tsx`)

## Sync Commands by Target

- `npm run mobile:sync`: build + full Capacitor sync (both platforms)
- `npm run mobile:sync:ios`: build + iOS sync only
- `npm run mobile:sync:android`: build + Android sync only
- `npm run mobile:sync:ios:dev`: iOS sync with `CAP_SERVER_URL=http://localhost:5000`
- `npm run mobile:sync:android:dev`: Android sync with `CAP_SERVER_URL=http://10.0.2.2:5000`
- `npm run mobile:sync:prod`: full sync with `CAP_SERVER_URL=https://www.sportfolio.market`

`mobile:ios:doctor` fails fast when iOS native config is accidentally synced with Android's `10.0.2.2` host.

## Android Emulator Setup

Run the SDK/emulator bootstrap helper (installs platform-tools, emulator, API image, and creates an AVD):

```bash
npm run android:emulator:setup
```

Optional flags:

```bash
node scripts/android-emulator-setup.mjs --api 36 --avd sportfolio-api-36 --sdk-root C:\Users\<you>\AppData\Local\Android\Sdk
```

After setup, start the emulator, then verify:

```bash
adb devices
```

## Sync Web + Native Projects

```bash
npm run mobile:sync
```

This command now:

1. builds web assets,
2. runs `cap sync`,
3. normalizes iOS SPM paths for cross-platform compatibility.

## Android

### Build Debug APK

```bash
cd mobile/android
gradlew assembleDebug
```

Or use npm script (cross-platform wrapper):

```bash
npm run mobile:build:android
```

### Install Debug APK to Device/Emulator

```bash
npm run mobile:install:android
```

If this fails with "No connected devices", start an emulator or connect a device and verify:

```bash
adb devices
```

### Build Release Artifacts

```bash
npm run mobile:build:android
```

By default this generates unsigned release artifacts. For signed output, set:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Optional versioning env vars:

- `MOBILE_VERSION_CODE` (integer)
- `MOBILE_VERSION_NAME` (for example `1.2.3`)

## iOS (macOS only)

### Build

```bash
npm run mobile:build:ios
```

The project uses `App.xcodeproj` (no workspace required in current setup).

### OAuth Deep Link

The app expects:

- `sportfolio://auth/callback`

Configured in:

- Android manifest (`custom_url_scheme = sportfolio`)
- iOS `Info.plist` URL types

## Runtime Backend Routing

Native builds are configured to load a hosted app URL through Capacitor server config.

Set `CAP_SERVER_URL` to override (recommended per environment):

```bash
CAP_SERVER_URL=https://www.sportfolio.market npm run mobile:sync
```

PowerShell:

```powershell
$env:CAP_SERVER_URL = "https://www.sportfolio.market"
npm run mobile:sync
```

Default fallback is `https://www.sportfolio.market`.

### URL Routing Guardrails

- iOS local simulator/device should use `http://localhost:5000`.
- Android emulator should use `http://10.0.2.2:5000`.
- `10.0.2.2` is Android-emulator-only and should not be used for iOS syncs.
- Use `npm run mobile:ios:doctor` after syncing to verify generated iOS config.

## Known Limitations

- iOS builds and simulator/device runs require macOS + Xcode; they cannot be fully validated from this Windows environment.
- If `CAP_SERVER_URL` points to a local URL, that server must be running before opening the native app shell.
- `mobile:ios:doctor` validates config and deep-link guardrails, but it does not replace a real Xcode run/signing check.

## GitHub CI Verification

Use GitHub CLI to quickly verify the required CI surface before merge:

```bash
gh pr checks --watch
gh run watch <run-id>
gh run view <run-id> --log-failed
```

Expected PR checks for mobile-impacting changes:

- `Pull Request CI / Validate Code`
- `iOS PR CI / ios-validate`

## GitHub iOS Simulator QA

A manual simulator QA workflow is included:

- `.github/workflows/ios-simulator-qa.yml`

Use it when you want GitHub-hosted macOS runners to:

- sync the iOS shell,
- build the simulator app,
- boot an iPhone simulator,
- install and launch the app,
- open a few core deep links,
- upload screenshots and logs as artifacts.

Run it from GitHub Actions:

1. Open **Actions**.
2. Select **iOS Simulator QA**.
3. Click **Run workflow**.
4. Use the default production `cap_server_url` for the safest first pass.

Notes:

- This is for simulator QA only, not App Store signing or real-device install.
- See `docs/ios-github-actions-rollout.md` for the full rollout sequence.

## Required Check Rollout (Post-Upgrade)

After upgrading repository plan to support private-repo rulesets/required checks:

1. Add required checks on `main`:
   - `Pull Request CI / Validate Code`
   - `iOS PR CI / ios-validate`
2. Require pull request before merge.
3. Enable stale-approval dismissal when new commits are pushed.

This enforces iOS gate failures as merge blockers, even for Windows-based contributors.

## Android Push Notifications (FCM)

Sportfolio Android push uses Capacitor Push Notifications + Firebase Cloud Messaging.

### Backend credentials

Set one of:

- `FIREBASE_ADMIN_SDK_JSON` (raw or base64 service-account JSON)
- `FIREBASE_ADMIN_SDK_FILE` (absolute path to JSON file)

If missing, the backend logs a warning and safely no-ops push sends (no crash in dev/test).

### Android app requirements

- `google-services.json` present at `mobile/android/app/google-services.json`
- Android permission `POST_NOTIFICATIONS` is declared in manifest
- Capacitor push plugin synced via:

```bash
npm run mobile:sync
```

### Runtime behavior

- Push registration is attempted only after sign-in on native Android.
- New users are prompted from the native onboarding notification step, and returning users get a single automatic prompt after auth bootstrap if permission is still pending.
- FCM token is sent to backend (`/api/mobile/push/register`) and refreshed on re-registration.
- Logout unregisters/deactivates token via `/api/mobile/push/unregister`.
- Notification taps route only to safe internal paths.
- The Android app creates a dedicated default notification channel (`sportfolio_general`) on-device.
- Users can manage permission state, per-notification preferences, and recent delivery diagnostics from the in-app profile push card and can jump straight to Android notification settings.
- Push diagnostics are available from `/api/mobile/push/status`.

## Common Install Failures

- `INSTALL_FAILED_VERSION_DOWNGRADE`: uninstall old app or increase `MOBILE_VERSION_CODE`.
- `INSTALL_PARSE_FAILED_NO_CERTIFICATES`: release APK is unsigned; configure Android signing env vars.
- `No connected devices`: connect device/emulator and run `adb devices`.
- iOS deep link not returning to app: verify URL scheme exists in `Info.plist`.

## Play Internal Testing (Private)

A GitHub Actions workflow is included:

- `.github/workflows/play-internal-testing.yml`

This uploads a signed `.aab` to the Play Console `internal` track (private tester distribution).

Required GitHub repository secrets:

- `PLAY_SERVICE_ACCOUNT_JSON`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Run it from GitHub Actions:

1. Open **Actions**.
2. Select **Play Internal Testing**.
3. Click **Run workflow**.

Before dispatching, run the Play release preflight:

```bash
npm run play:release:preflight
```

This checks:

- required GitHub secrets for the upload workflow,
- local upload keystore readability/fingerprint (when `ANDROID_KEYSTORE_PASSWORD` is set),
- Play billing product readiness via the billing doctor.

Notes:

- Internal testing is private and suitable for getting release process moving before public launch.
- For some personal Play developer accounts, Google requires a closed testing phase before production access.

## Play Closed Testing (Manual)

A second manual workflow is included:

- `.github/workflows/play-closed-testing.yml`

This uploads a signed `.aab` to a Play Console closed testing track.

Run it from GitHub Actions:

1. Open **Actions**.
2. Select **Play Closed Testing**.
3. Click **Run workflow**.
4. Optionally set `closed_track` (default `alpha`) to match your Play closed track ID.

Required GitHub repository secrets are the same as internal testing:

- `PLAY_SERVICE_ACCOUNT_JSON`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## Firebase App Distribution (Manual)

Workflow:

- `.github/workflows/firebase-distribution.yml`

Behavior:

- Runs only when you manually dispatch it from GitHub Actions.
- Always includes `michaelhmiv@gmail.com` as a tester by default.
- Still supports optional repository secrets:
- `FIREBASE_DISTRIBUTION_TESTERS` (comma-separated emails)
- `FIREBASE_DISTRIBUTION_GROUPS` (comma-separated group aliases)
- Testers/groups are combined and deduplicated before upload.

Run it from GitHub Actions:

1. Open **Actions**.
2. Select **Firebase App Distribution**.
3. Click **Run workflow**.
4. Optionally set `release_name` to make the Firebase release easier to identify.

## Google Play Billing Automation

Android Premium Share purchases now use Google Play Billing in native Android builds.

Backend env vars required for purchase verification:

- `PLAY_SERVICE_ACCOUNT_JSON` or `PLAY_SERVICE_ACCOUNT_FILE`
- `GOOGLE_PLAY_PACKAGE_NAME` (default: `sportfolio.market`)
- `GOOGLE_PLAY_PREMIUM_PRODUCT_ID` (default: `premium_share_1`)
- optional `GOOGLE_PLAY_PREMIUM_PRODUCT_IDS` (comma-separated allowlist)

Client env var (for Android product lookup):

- `VITE_ANDROID_PREMIUM_PRODUCT_ID` (default: `premium_share_1`)

Use the billing doctor script to validate API access and product setup:

```bash
npm run play:billing:doctor
```

If the product does not exist yet, create it via API:

```bash
npm run play:billing:ensure-product
```

Optional overrides:

```bash
node scripts/play-billing-doctor.mjs --ensure --package sportfolio.market --product premium_share_1 --price-usd 5
```

## Android QA Smoke Checklist

Use this checklist for Android app smoke validation after push/backend changes:

1. Build debug:
   `npm run mobile:install:android`
2. Build release:
   `npm run mobile:build:android`
3. Push token registration:
   sign in on Android and verify backend receives token via `/api/mobile/push/register`.
4. Notification permission request timing:
   confirm prompt is not shown before sign-in/auth bootstrap completes.
5. Foreground notification behavior:
   send test push and verify in-app toast/display behavior while app is open.
6. Background notification behavior:
   send test push while app is backgrounded and verify system notification appears.
7. Notification tap routing:
   verify taps route correctly for `/boosts`, `/portfolio`, `/pools`, `/player/:id`, `/watchlists`, `/premium`, `/news`, or `/`.
8. Logout token deactivation:
   log out and verify `/api/mobile/push/unregister` deactivates current token.
9. Boost settled trigger:
   verify boost settlement creates a push notification to `/boosts`.
10. Scout complete trigger:
    verify scout completion creates a push notification to `/portfolio`.
11. Invalid token handling:
    force an invalid token response and confirm token is marked inactive.
12. Missing Firebase credentials behavior:
    run without Firebase credentials and confirm warning/no-op behavior (no server crash).
13. Billing regression:
    verify Google Play Billing purchase flow still works.
14. Rewarded ads regression:
    verify rewarded scout boost flow still works.
15. Auth deep link regression:
    verify `sportfolio://auth/callback` still resumes session correctly.
