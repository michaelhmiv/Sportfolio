from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "server/supabaseAuth.ts"
source = path.read_text(encoding="utf-8")

import_anchor = 'import { registerWebAuthRoutes } from "./auth/web-auth";'
if 'tryAttachNativeAuthPrincipal' not in source:
    source = source.replace(
        import_anchor,
        import_anchor + '\nimport { registerNativeAuthRoutes, tryAttachNativeAuthPrincipal } from "./auth/native-auth";',
        1,
    )

required_ba = '''      if (await tryAttachBetterAuthPrincipal(req, authConfig)) {
        next();
        return;
      }'''
required_native = required_ba + '''
      if (await tryAttachNativeAuthPrincipal(req)) {
        next();
        return;
      }'''
if source.count(required_ba) < 2:
    raise SystemExit("Expected Better Auth middleware anchors")
source = source.replace(required_ba, required_native)

register_anchor = '  registerWebAuthRoutes(app);'
if 'registerNativeAuthRoutes(app);' not in source:
    source = source.replace(register_anchor, register_anchor + '\n  registerNativeAuthRoutes(app);', 1)

path.write_text(source, encoding="utf-8")
