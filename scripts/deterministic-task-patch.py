from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "4803cc9ed24fc87753066a893b8ad0652483869c/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
old = 'pattern = re.compile(r"const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = \\[(.*?)\\];", re.S)'
new = 'pattern = re.compile(r"const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = \\[(.*?)\\] as const;", re.S)'
if source.count(old) != 1:
    raise RuntimeError("Unable to locate the public tool capability regex in the pinned patch")
source = source.replace(old, new, 1)
exec(compile(source, SOURCE_URL, "exec"), {"__file__": str(Path(__file__).resolve()), "__name__": "__main__"})
