from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "config/public-capability-snapshot.json"
snapshot = json.loads(path.read_text())
retired = {"review_idle_cash", "review_setup"}
entries = snapshot.get("entries", [])
removed = [entry for entry in entries if entry.get("kind") == "prompt" and entry.get("name") in retired]
if {entry.get("name") for entry in removed} != retired:
    raise SystemExit("Expected retired prompt entries were not both present in the reviewed baseline")
snapshot["entries"] = [
    entry
    for entry in entries
    if not (entry.get("kind") == "prompt" and entry.get("name") in retired)
]
path.write_text(json.dumps(snapshot, indent=2) + "\n")
