from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "4fe6fd1f9bd800a59a1768eb50533ff439947cdf/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
old = '(ROOT / "docs/operations/scout-distribution-claims-repair.md").write_text(runbook)'
new = '(ROOT / "docs/operations").mkdir(parents=True, exist_ok=True)\n(ROOT / "docs/operations/scout-distribution-claims-repair.md").write_text(runbook)'
if source.count(old) != 1:
    raise RuntimeError("Unable to locate runbook write in pinned scout migration patch")
source = source.replace(old, new, 1)
exec(compile(source, SOURCE_URL, "exec"), {"__file__": str(Path(__file__).resolve()), "__name__": "__main__"})
