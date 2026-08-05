from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
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
