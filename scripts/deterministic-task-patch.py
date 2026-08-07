from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
changed = 0
for path in (ROOT / "server").rglob("*.ts"):
    if path.name == "supabaseAuth.ts":
        continue
    source = path.read_text(encoding="utf-8")
    updated = source.replace("./supabaseAuth", "./auth/runtime-auth")
    updated = updated.replace("../supabaseAuth", "../auth/runtime-auth")
    updated = updated.replace("../../supabaseAuth", "../../auth/runtime-auth")
    updated = updated.replace("../../../supabaseAuth", "../../../auth/runtime-auth")
    if updated != source:
        path.write_text(updated, encoding="utf-8")
        changed += 1
print(f"Updated runtime-auth imports in {changed} files")
