from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "chatgpt-app-submission.json"
submission = json.loads(path.read_text())

read_only = "Retrieves sanitized sports_data information and does not modify Sportfolio account or gameplay state."
open_world = "Operates only within the connected user's private Sportfolio game account and does not publish to the public internet or modify an unrelated third-party system."
destructive = "Does not delete, revoke, irreversibly overwrite, or finalize a destructive action according to the implemented tool behavior."
entry = {
    "annotations": {
        "readOnlyHint": True,
        "openWorldHint": False,
        "destructiveHint": False,
    },
    "justifications": {
        "read_only_justification": read_only,
        "open_world_justification": open_world,
        "destructive_justification": destructive,
    },
}
for name in [
    "get_supported_sports_capabilities",
    "search_sports_entities",
    "get_sports_entity",
    "get_event_slate",
    "get_event_live_state",
]:
    submission["tools"][name] = entry
submission["tools"] = dict(sorted(submission["tools"].items()))
path.write_text(json.dumps(submission, indent=2) + "\n")
