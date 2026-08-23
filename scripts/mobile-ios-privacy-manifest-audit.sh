#!/usr/bin/env bash
set -euo pipefail

report_path="${IOS_PRIVACY_MANIFEST_REPORT:-tmp/ios-privacy-manifests.txt}"
scan_roots_value="${IOS_PRIVACY_SCAN_ROOTS:-mobile/ios}"
mkdir -p "$(dirname "${report_path}")"
: > "${report_path}"

# The workflow passes one or more roots separated by newlines. Keep the
# default source tree useful for local runs as well.
scan_roots=()
while IFS= read -r root; do
  scan_roots[${#scan_roots[@]}]="${root}"
done < <(printf '%s\n' "${scan_roots_value}" | sed '/^[[:space:]]*$/d')

manifest_count=0
invalid_count=0
missing_root_count=0

for root in "${scan_roots[@]}"; do
  if [[ ! -d "${root}" ]]; then
    printf 'Missing scan root: %s\n' "${root}" | tee -a "${report_path}" >&2
    missing_root_count=$((missing_root_count + 1))
    continue
  fi

  while IFS= read -r -d '' manifest_path; do
    manifest_count=$((manifest_count + 1))
    if plutil -lint "${manifest_path}" >/dev/null 2>&1; then
      printf 'VALID %s\n' "${manifest_path}" | tee -a "${report_path}"
    else
      printf 'INVALID %s\n' "${manifest_path}" | tee -a "${report_path}" >&2
      invalid_count=$((invalid_count + 1))
    fi
  done < <(find "${root}" -type f -name 'PrivacyInfo.xcprivacy' -print0)
done

if (( missing_root_count > 0 )); then
  printf 'Privacy manifest audit failed: %d scan root(s) are missing.\n' "${missing_root_count}" >&2
  exit 1
fi

if (( invalid_count > 0 )); then
  printf 'Privacy manifest audit failed: %d invalid manifest(s).\n' "${invalid_count}" >&2
  exit 1
fi

if (( manifest_count == 0 )); then
  printf 'No PrivacyInfo.xcprivacy files found under the configured scan roots.\n' | tee -a "${report_path}"
else
  printf 'Privacy manifest audit passed: %d valid manifest(s).\n' "${manifest_count}" | tee -a "${report_path}"
fi
