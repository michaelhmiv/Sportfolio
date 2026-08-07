from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package.get("dependencies", {}).pop("@supabase/supabase-js", None)
scripts = package.get("scripts", {})
scripts.pop("auth:supabase-inventory", None)
scripts["auth:compatibility:test"] = "vitest run scripts/better-auth-compatibility.test.ts server/auth/architecture-contract.test.ts"
scripts["auth:foundation:test"] = "vitest run server/auth/principal.test.ts server/auth/better-auth.test.ts server/auth/better-auth-session.test.ts server/auth/native-auth.test.ts"
scripts["retired-runtime:audit"] = "node scripts/audit-retired-runtime.mjs"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts"], cwd=ROOT, check=True)
