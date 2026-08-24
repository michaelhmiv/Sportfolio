#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REPORT_PATH="${IOS_PRIVACY_MANIFEST_REPORT:-tmp/ios-privacy-manifests.txt}"
mkdir -p "$(dirname "$REPORT_PATH")"
: > "$REPORT_PATH"

roots=(
  "node_modules/@capacitor/ios"
  "mobile/ios/App"
)

if [[ -d "${HOME:-}/Library/Developer/Xcode/DerivedData" ]]; then
  roots+=("$HOME/Library/Developer/Xcode/DerivedData")
fi

if [[ -n "${IOS_PRIVACY_SCAN_ROOTS:-}" ]]; then
  IFS=':' read -r -a extra_roots <<< "$IOS_PRIVACY_SCAN_ROOTS"
  for root in "${extra_roots[@]}"; do
    [[ -n "$root" ]] && roots+=("$root")
  done
fi

existing_roots=()
for root in "${roots[@]}"; do
  if [[ -e "$root" ]]; then
    existing_roots+=("$root")
  fi
done

if [[ ${#existing_roots[@]} -eq 0 ]]; then
  echo "::error::No iOS privacy-manifest scan roots exist. Run npm ci and the iOS build/sync first."
  exit 1
fi

find "${existing_roots[@]}" -type f -name 'PrivacyInfo.xcprivacy' -print 2>/dev/null \
  | sort -u > "$REPORT_PATH"

manifest_count="$(grep -c . "$REPORT_PATH" || true)"
if [[ "$manifest_count" -eq 0 ]]; then
  echo "::error::No PrivacyInfo.xcprivacy files were found in the iOS dependency/build surface."
  exit 1
fi

echo "Found ${manifest_count} privacy manifest(s):"
cat "$REPORT_PATH"

invalid=0
while IFS= read -r manifest; do
  [[ -z "$manifest" ]] && continue
  if ! plutil -lint "$manifest" >/dev/null; then
    echo "::error::Invalid privacy manifest: $manifest"
    invalid=1
  fi
done < "$REPORT_PATH"

if [[ "$invalid" -ne 0 ]]; then
  exit 1
fi

if ! grep -Eqi 'Capacitor[^/]*|/Capacitor/' "$REPORT_PATH"; then
  echo "::error::Could not identify a Capacitor privacy manifest. Apple lists Capacitor as a commonly used SDK that must include a privacy manifest and signature."
  exit 1
fi

if ! grep -Eqi 'Cordova|CapacitorCordova' "$REPORT_PATH"; then
  echo "::error::Could not identify a Cordova/CapacitorCordova privacy manifest. Apple lists Cordova as a commonly used SDK that must include a privacy manifest and signature."
  exit 1
fi

echo "Validated required Capacitor and Cordova privacy-manifest presence."

if grep -Eqi 'GoogleMobileAds|UserMessagingPlatform|Google.*Ads' "$REPORT_PATH"; then
  echo "Detected Google Mobile Ads/User Messaging Platform privacy manifest(s)."
else
  echo "::warning::No Google Mobile Ads/User Messaging Platform privacy manifest was identifiable by path. Verify the final Xcode privacy report before App Store review and reconcile it with App Store Connect App Privacy answers."
fi

echo "Privacy-manifest audit complete. Report: $REPORT_PATH"
