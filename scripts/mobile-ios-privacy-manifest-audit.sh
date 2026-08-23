#!/usr/bin/env bash
set -euo pipefail

REPORT_PATH="${IOS_PRIVACY_MANIFEST_REPORT:-tmp/ios-privacy-manifests.txt}"
SCAN_ROOTS_RAW="${IOS_PRIVACY_SCAN_ROOTS:-tmp/ios-derived-data}"

mkdir -p "$(dirname "${REPORT_PATH}")"
: > "${REPORT_PATH}"

manifest_list="$(mktemp)"
trap 'rm -f "${manifest_list}"' EXIT

failures=0
roots_seen=0

# IOS_PRIVACY_SCAN_ROOTS accepts a colon-separated list so CI can audit both
# DerivedData and any additional archive/package roots without changing this script.
IFS=':' read -r -a scan_roots <<< "${SCAN_ROOTS_RAW}"
for root in "${scan_roots[@]}"; do
  [[ -n "${root}" ]] || continue
  roots_seen=$((roots_seen + 1))
  if [[ ! -d "${root}" ]]; then
    echo "[ios-privacy] ERROR: scan root does not exist: ${root}" | tee -a "${REPORT_PATH}"
    failures=$((failures + 1))
    continue
  fi

  echo "[ios-privacy] Scanning ${root}" | tee -a "${REPORT_PATH}"
  find "${root}" -type f -name 'PrivacyInfo.xcprivacy' -print >> "${manifest_list}"
done

if [[ "${roots_seen}" -eq 0 ]]; then
  echo "[ios-privacy] ERROR: IOS_PRIVACY_SCAN_ROOTS did not contain a usable scan root." | tee -a "${REPORT_PATH}"
  exit 1
fi

sort -u "${manifest_list}" -o "${manifest_list}"
manifest_count=0

while IFS= read -r manifest; do
  [[ -n "${manifest}" ]] || continue
  manifest_count=$((manifest_count + 1))
  echo "" | tee -a "${REPORT_PATH}"
  echo "[ios-privacy] Manifest: ${manifest}" | tee -a "${REPORT_PATH}"

  if ! /usr/bin/plutil -lint "${manifest}" 2>&1 | tee -a "${REPORT_PATH}"; then
    echo "[ios-privacy] ERROR: invalid property-list syntax: ${manifest}" | tee -a "${REPORT_PATH}"
    failures=$((failures + 1))
    continue
  fi

  if ! python3 - "${manifest}" <<'PY' 2>&1 | tee -a "${REPORT_PATH}"
import plistlib
import sys

path = sys.argv[1]
with open(path, "rb") as handle:
    data = plistlib.load(handle)

if not isinstance(data, dict):
    raise SystemExit("ERROR: privacy manifest root must be a dictionary")

tracking = data.get("NSPrivacyTracking")
if tracking is not None and not isinstance(tracking, bool):
    raise SystemExit("ERROR: NSPrivacyTracking must be a boolean")

tracking_domains = data.get("NSPrivacyTrackingDomains")
if tracking_domains is not None and (
    not isinstance(tracking_domains, list)
    or any(not isinstance(item, str) or not item.strip() for item in tracking_domains)
):
    raise SystemExit("ERROR: NSPrivacyTrackingDomains must be an array of non-empty strings")

accessed = data.get("NSPrivacyAccessedAPITypes", [])
if not isinstance(accessed, list):
    raise SystemExit("ERROR: NSPrivacyAccessedAPITypes must be an array")
for index, entry in enumerate(accessed):
    if not isinstance(entry, dict):
        raise SystemExit(f"ERROR: NSPrivacyAccessedAPITypes[{index}] must be a dictionary")
    api_type = entry.get("NSPrivacyAccessedAPIType")
    reasons = entry.get("NSPrivacyAccessedAPITypeReasons")
    if not isinstance(api_type, str) or not api_type.strip():
        raise SystemExit(f"ERROR: NSPrivacyAccessedAPITypes[{index}] is missing NSPrivacyAccessedAPIType")
    if (
        not isinstance(reasons, list)
        or not reasons
        or any(not isinstance(reason, str) or not reason.strip() for reason in reasons)
    ):
        raise SystemExit(
            f"ERROR: NSPrivacyAccessedAPITypes[{index}] must declare at least one required-reason code"
        )

collected = data.get("NSPrivacyCollectedDataTypes", [])
if not isinstance(collected, list):
    raise SystemExit("ERROR: NSPrivacyCollectedDataTypes must be an array")
for index, entry in enumerate(collected):
    if not isinstance(entry, dict):
        raise SystemExit(f"ERROR: NSPrivacyCollectedDataTypes[{index}] must be a dictionary")
    data_type = entry.get("NSPrivacyCollectedDataType")
    linked = entry.get("NSPrivacyCollectedDataTypeLinked")
    tracking_value = entry.get("NSPrivacyCollectedDataTypeTracking")
    purposes = entry.get("NSPrivacyCollectedDataTypePurposes")
    if not isinstance(data_type, str) or not data_type.strip():
        raise SystemExit(f"ERROR: NSPrivacyCollectedDataTypes[{index}] is missing NSPrivacyCollectedDataType")
    if not isinstance(linked, bool):
        raise SystemExit(f"ERROR: NSPrivacyCollectedDataTypes[{index}] must declare Linked as a boolean")
    if not isinstance(tracking_value, bool):
        raise SystemExit(f"ERROR: NSPrivacyCollectedDataTypes[{index}] must declare Tracking as a boolean")
    if not isinstance(purposes, list) or any(not isinstance(item, str) or not item.strip() for item in purposes):
        raise SystemExit(f"ERROR: NSPrivacyCollectedDataTypes[{index}] has invalid Purposes")

print(
    "PASS: valid privacy manifest "
    f"(required-reason APIs={len(accessed)}, collected-data declarations={len(collected)})"
)
PY
  then
    echo "[ios-privacy] ERROR: semantic validation failed: ${manifest}" | tee -a "${REPORT_PATH}"
    failures=$((failures + 1))
  fi
done < "${manifest_list}"

if [[ "${manifest_count}" -eq 0 ]]; then
  echo "[ios-privacy] ERROR: no PrivacyInfo.xcprivacy files were found in the built dependency graph." | tee -a "${REPORT_PATH}"
  echo "[ios-privacy] This usually means required SDK privacy manifests were not resolved or embedded during the iOS build." | tee -a "${REPORT_PATH}"
  failures=$((failures + 1))
fi

echo "" | tee -a "${REPORT_PATH}"
echo "[ios-privacy] Audited ${manifest_count} privacy manifest(s); failures=${failures}." | tee -a "${REPORT_PATH}"

if [[ "${failures}" -ne 0 ]]; then
  exit 1
fi

echo "[ios-privacy] All discovered iOS privacy manifests are syntactically and structurally valid." | tee -a "${REPORT_PATH}"
