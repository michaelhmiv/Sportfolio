from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for source_root in (ROOT / "server", ROOT / "shared", ROOT / "client"):
    if not source_root.exists():
        continue
    for source_path in source_root.rglob("*.ts*"):
        content = source_path.read_text(encoding="utf-8")
        updated = content.replace(
            "z.record(z.unknown())",
            "z.record(z.string(), z.unknown())",
        ).replace(
            "z.record(z.any())",
            "z.record(z.string(), z.any())",
        )
        if updated != content:
            source_path.write_text(updated, encoding="utf-8")

config_path = ROOT / "server/auth/config.ts"
config = config_path.read_text(encoding="utf-8")
config = config.replace('booleanFlag.default("false")', "booleanFlag.default(false)")
config = config.replace('booleanFlag.default("true")', "booleanFlag.default(true)")
config_path.write_text(config, encoding="utf-8")

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))

scripts = package.setdefault("scripts", {})
scripts["auth:supabase-inventory"] = "tsx scripts/auth-supabase-inventory.ts"
scripts["auth:compatibility:test"] = (
    "vitest run scripts/auth-supabase-inventory.test.ts "
    "scripts/better-auth-compatibility.test.ts "
    "server/auth/architecture-contract.test.ts"
)

dependencies = package.setdefault("dependencies", {})
dependencies["better-auth"] = "1.6.25"
dependencies["@better-auth/oauth-provider"] = "1.6.25"
dependencies["zod"] = "4.4.3"
dependencies["drizzle-zod"] = "0.8.3"

package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

subprocess.run(
    ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    cwd=ROOT,
    check=True,
)
subprocess.run(
    [
        "npx",
        "tsx",
        "scripts/auth-supabase-inventory.ts",
        "--write",
        "docs/auth/supabase-exit-inventory.md",
    ],
    cwd=ROOT,
    check=True,
)
