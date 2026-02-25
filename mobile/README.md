# Mobile Build + Install Runbook

This project uses Capacitor with native projects in:

- `mobile/android`
- `mobile/ios`

## Prerequisites

- Node.js + npm
- Java 21
- Android SDK + `adb` in `PATH` (for install to device/emulator)
- Xcode (macOS only, for iOS)
- Firebase CLI (`firebase`)

## One-time Verification

```bash
npx cap doctor
firebase --version
firebase projects:list
```

Confirm Firebase Android config matches app package:

- file: `mobile/android/app/google-services.json`
- expected package: `sportfolio.market`

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

Notes:

- Internal testing is private and suitable for getting release process moving before public launch.
- For some personal Play developer accounts, Google requires a closed testing phase before production access.
