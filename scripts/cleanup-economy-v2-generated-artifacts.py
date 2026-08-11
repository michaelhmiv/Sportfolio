#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "config/public-capability-snapshot.json"

payload = json.loads(SNAPSHOT.read_text())

removed = 0

def clean(value):
    global removed
    if isinstance(value, list):
        result = []
        for item in value:
            if isinstance(item, dict) and item.get("name") == "stage_stack_shares":
                removed += 1
                continue
            result.append(clean(item))
        return result
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    return value

cleaned = clean(payload)
if removed != 1:
    raise SystemExit(f"Expected to remove exactly one stage_stack_shares capability, removed {removed}")

SNAPSHOT.write_text(json.dumps(cleaned, indent=2) + "\n")
print("Removed retired stage_stack_shares capability from generated snapshot")
