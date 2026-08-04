from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "10d8c0cc78549629565bea5c4ce870721bfd33a5/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
old = '''  if (abstract === "final" || value.includes("final") || value.includes("completed")) {
    return resolution("final", source);
  }
  if (abstract === "live" || value.includes("in progress") || value === "live") {
    return resolution("in_progress", source);
  }
  if (value.includes("delay")) {
'''
new = '''  if (abstract === "final" || value.includes("final") || value.includes("completed")) {
    return resolution("final", source);
  }
  if (value.includes("delay")) {
'''
if source.count(old) != 1:
    raise RuntimeError("Unable to locate MLB delay precedence block in pinned semantic patch")
source = source.replace(old, new, 1)
old_tail = '''    return resolution(
      "unknown",
      source,
      "fallback",
      "unknown",
      "Delayed state lacked an authoritative live or preview phase.",
    );
  }
  if (["preview", "scheduled", "pre-game", "pregame"].some((token) => value.includes(token))) {
'''
new_tail = '''    return resolution(
      "unknown",
      source,
      "fallback",
      "unknown",
      "Delayed state lacked an authoritative live or preview phase.",
    );
  }
  if (abstract === "live" || value.includes("in progress") || value === "live") {
    return resolution("in_progress", source);
  }
  if (["preview", "scheduled", "pre-game", "pregame"].some((token) => value.includes(token))) {
'''
if source.count(old_tail) != 1:
    raise RuntimeError("Unable to locate MLB delay tail in pinned semantic patch")
source = source.replace(old_tail, new_tail, 1)
exec(compile(source, SOURCE_URL, "exec"), {"__file__": str(Path(__file__).resolve()), "__name__": "__main__"})
