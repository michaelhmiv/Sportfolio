from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "server/mcp/public-tool-registry.ts"

registry = REGISTRY.read_text(encoding="utf-8")
old = "  const expectedPromptNames = new Set<string>(PUBLIC_PROMPT_NAMES);"
new = "  const expectedPromptNames = new Set<string>(\n    PUBLIC_PROMPT_NAMES.filter(isApprovedPublicPromptName),\n  );"
if old not in registry:
    raise RuntimeError("Expected prompt parity declaration was not found.")
registry = registry.replace(old, new, 1)
REGISTRY.write_text(registry, encoding="utf-8")

subprocess.run(
    [
        "git",
        "checkout",
        "origin/main",
        "--",
        "server/mcp/plugin/ui/generated-widget.ts",
    ],
    cwd=ROOT,
    check=True,
)

print("Aligned retired prompt parity and restored the generated widget from main.")
