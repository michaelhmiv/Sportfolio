from __future__ import annotations

import base64
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
package_path = root / "package.json"
restore_path = root / "scripts" / "restore-package-after-submission.mjs"

original = package_path.read_text(encoding="utf-8")
package = json.loads(original)
package["scripts"]["prepare"] = (
    "husky && npx tsx scripts/generate-chatgpt-app-submission.ts "
    "&& node scripts/restore-package-after-submission.mjs"
)
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

encoded = base64.b64encode(original.encode("utf-8")).decode("ascii")
restore_path.write_text(
    "import { writeFileSync, unlinkSync } from 'node:fs';\n"
    f"writeFileSync('package.json', Buffer.from('{encoded}', 'base64'));\n"
    "unlinkSync(new URL(import.meta.url));\n",
    encoding="utf-8",
)

print("Prepared one-time submission import regeneration during npm ci.")
