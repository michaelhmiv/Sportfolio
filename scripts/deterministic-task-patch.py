from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
subprocess.run(
    [
        "npx",
        "prettier",
        "scripts/reconcile-better-auth-identities.ts",
        "scripts/audit-retired-runtime.mjs",
        "--write",
    ],
    cwd=ROOT,
    check=True,
)
