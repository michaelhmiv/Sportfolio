# Mobile Build + Install Runbook

This project uses Capacitor with native projects in:

- `mobile/android`
- `mobile/ios`

## Prerequisites

- Node.js + npm
- Java 21
- Android SDK + emulator tooling (`adb`, `sdkmanager`, `avdmanager`) in `PATH`
- Xcode (macOS only, for iOS)
- Firebase CLI (`firebase`)

## One-time Verification

```bash
npx cap doctor
firebase --version
firebase projects:list
npm run android:sdk:check
```

Confirm Firebase Android config matches app package:

- file: `mobile/android/app/google-services.json`
- expected package: `sportfolio.market`

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
- Notification permission is requested after auth bootstrap (not on app cold-start/login).
- FCM token is sent to backend (`/api/mobile/push/register`) and refreshed on re-registration.
- Logout unregisters/deactivates token via `/api/mobile/push/unregister`.
- Notification taps route only to safe internal paths.

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

## Firebase App Distribution (Auto on Main)

Workflow:

- `.github/workflows/firebase-distribution.yml`

Behavior:

- Runs automatically on each push to `main` and can also be run manually.
- Always includes `michaelhmiv@gmail.com` as a tester by default.
- Still supports optional repository secrets:
- `FIREBASE_DISTRIBUTION_TESTERS` (comma-separated emails)
- `FIREBASE_DISTRIBUTION_GROUPS` (comma-separated group aliases)
- Testers/groups are combined and deduplicated before upload.

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
