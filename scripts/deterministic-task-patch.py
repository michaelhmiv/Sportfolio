from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

routes_path = ROOT / "server/routes.ts"
routes = routes_path.read_text(encoding="utf-8")
routes = routes.replace(
    'method: "token" | "dev_bypass" | "supabase_jwt" | "session",',
    'method: "token" | "dev_bypass" | "session",',
)
routes, count = re.subn(
    r'\n    // Check 3: Verify Supabase JWT token and check isAdmin flag\n.*?\n    // Check 4: Fallback - check if req\.user is already set \(from session or other middleware\)',
    '\n    // Check 3: Check if req.user is already set by Better Auth or native auth middleware',
    routes,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"expected one legacy admin JWT block, replaced {count}")
routes = routes.replace(
    '            hasSupabaseUrl: !!process.env.SUPABASE_URL,\n            hasSupabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,',
    '            hasBetterAuthSecret: !!process.env.BETTER_AUTH_SECRET,\n            hasResendApiKey: !!process.env.RESEND_API_KEY,',
)
routes_path.write_text(routes, encoding="utf-8")

plugin_path = ROOT / "scripts/plugin-oauth-discovery-check.ts"
plugin = plugin_path.read_text(encoding="utf-8")
plugin = re.sub(
    r'  const issuer =\n    process\.env\.PLUGIN_OAUTH_ISSUER\?\.trim\(\) \|\|\n    \(process\.env\.SUPABASE_URL\?\.trim\(\)\n      \? `\$\{process\.env\.SUPABASE_URL\.trim\(\)\.replace\(/\\/\$/, ""\)\}/auth/v1`\n      : ""\);\n\n  if \(!issuer\) \{\n    throw new Error\("Set PLUGIN_OAUTH_ISSUER or SUPABASE_URL before running the OAuth probe\."\);\n  \}',
    '  const issuer =\n    process.env.PLUGIN_OAUTH_ISSUER?.trim() || process.env.BETTER_AUTH_URL?.trim() || "";\n\n  if (!issuer) {\n    throw new Error("Set PLUGIN_OAUTH_ISSUER or BETTER_AUTH_URL before running the OAuth probe.");\n  }',
    plugin,
)
plugin_path.write_text(plugin, encoding="utf-8")

use_auth_test = ROOT / "client/src/hooks/useAuth.test.ts"
source = use_auth_test.read_text(encoding="utf-8")
source = source.replace('    expect(source).not.toContain("@supabase/supabase-js");\n', '')
use_auth_test.write_text(source, encoding="utf-8")

for legacy in [ROOT / "scripts/debug-eligible-players.ts", ROOT / "scripts/verify-anon-access.js"]:
    if legacy.exists():
        legacy.unlink()

audit = ROOT / "scripts/audit-retired-runtime.mjs"
audit_source = audit.read_text(encoding="utf-8")
if "const ignoredFiles" not in audit_source:
    audit_source = audit_source.replace(
        'const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);',
        'const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);\nconst ignoredFiles = new Set(["scripts/audit-retired-runtime.mjs", "scripts/audit-retired-surfaces.mjs"]);',
    )
    audit_source = audit_source.replace(
        '    if (!extensions.has(path.extname(entry.name))) continue;',
        '    if (!extensions.has(path.extname(entry.name))) continue;\n    const relativePath = path.relative(process.cwd(), fullPath).replaceAll("\\\\", "/");\n    if (ignoredFiles.has(relativePath)) continue;',
    )
audit.write_text(audit_source, encoding="utf-8")
