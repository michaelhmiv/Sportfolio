from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

previous = subprocess.check_output(
    ["git", "show", "HEAD^:scripts/deterministic-task-patch.py"],
    cwd=ROOT,
    text=True,
)
exec(compile(previous, "scripts/deterministic-task-patch.py", "exec"))


def replace(path: str, old: str, new: str, count: int = -1) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if old not in content:
        raise SystemExit(f"Expected patch anchor missing in {path}: {old[:80]!r}")
    content = content.replace(old, new, count)
    target.write_text(content, encoding="utf-8")


replace(
    "server/auth/better-auth-session.ts",
    'import { getBetterAuthServer } from "./better-auth";\n',
    "",
)
replace(
    "server/auth/better-auth-session.ts",
    '''async function defaultGetSession(req: Request): Promise<BetterAuthSessionData | null> {
  const result = await getBetterAuthServer().api.getSession({''',
    '''async function defaultGetSession(req: Request): Promise<BetterAuthSessionData | null> {
  const { getBetterAuthServer } = await import("./better-auth");
  const result = await getBetterAuthServer().api.getSession({''',
)

replace(
    "server/auth/web-auth.ts",
    'import { BETTER_AUTH_BASE_PATH, getBetterAuthServer } from "./better-auth";',
    'import { BETTER_AUTH_BASE_PATH } from "./better-auth";',
)
replace(
    "server/auth/web-auth.ts",
    '''  const endpoint = new URL(`${BETTER_AUTH_BASE_PATH}/sign-in/magic-link`, config.BETTER_AUTH_URL);
  return getBetterAuthServer(config).handler(''',
    '''  const endpoint = new URL(`${BETTER_AUTH_BASE_PATH}/sign-in/magic-link`, config.BETTER_AUTH_URL);
  const { getBetterAuthServer } = await import("./better-auth");
  return getBetterAuthServer(config).handler(''',
)
replace(
    "server/auth/web-auth.ts",
    '''export function registerWebAuthRoutes(
  app: Express,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): boolean {
  if (
    config.AUTH_PROVIDER === "SUPABASE" ||
    !config.AUTH_MAGIC_LINK_ENABLED ||
    !config.BETTER_AUTH_URL
  ) {''',
    '''export function registerWebAuthRoutes(
  app: Express,
  config?: AuthRuntimeConfig,
): boolean {
  const rawProvider = (process.env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();
  if (!config && rawProvider === "SUPABASE") {
    logger.info("Passwordless web routes remain disabled");
    return false;
  }
  const resolvedConfig = config ?? getAuthRuntimeConfig();
  if (
    resolvedConfig.AUTH_PROVIDER === "SUPABASE" ||
    !resolvedConfig.AUTH_MAGIC_LINK_ENABLED ||
    !resolvedConfig.BETTER_AUTH_URL
  ) {''',
)
replace(
    "server/auth/web-auth.ts",
    "normalizeWebAuthDestination(parsed.data.returnTo, config)",
    "normalizeWebAuthDestination(parsed.data.returnTo, resolvedConfig)",
)
replace(
    "server/auth/web-auth.ts",
    'new URL("/auth/complete", config.PUBLIC_SITE_URL)',
    'new URL("/auth/complete", resolvedConfig.PUBLIC_SITE_URL)',
)
replace(
    "server/auth/web-auth.ts",
    "submitMagicLink(parsed.data.email, callback.toString(), config)",
    "submitMagicLink(parsed.data.email, callback.toString(), resolvedConfig)",
)
replace(
    "server/auth/web-auth.ts",
    "tryAttachBetterAuthPrincipal(req, config)",
    "tryAttachBetterAuthPrincipal(req, resolvedConfig)",
)

replace(
    "server/supabaseAuth.ts",
    '''  const authConfig = getAuthRuntimeConfig();
  if (authConfig.AUTH_PROVIDER !== "SUPABASE") {''',
    '''  const rawAuthProvider = (process.env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();
  if (rawAuthProvider !== "SUPABASE") {
    const authConfig = getAuthRuntimeConfig();''',
)
replace(
    "server/supabaseAuth.ts",
    "  registerWebAuthRoutes(app, getAuthRuntimeConfig());",
    "  registerWebAuthRoutes(app);",
)

# Supabase middleware tests must explicitly own the provider variable they exercise,
# rather than inheriting a DUAL setting from another Vitest file in the worker.
test_path = ROOT / "server/supabaseAuth.test.ts"
test_content = test_path.read_text(encoding="utf-8")
test_content = test_content.replace(
    '''    SUPABASE_KEY: process.env.SUPABASE_KEY,
  };''',
    '''    SUPABASE_KEY: process.env.SUPABASE_KEY,
    AUTH_PROVIDER: process.env.AUTH_PROVIDER,
  };''',
)
test_content = test_content.replace(
    '''    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";''',
    '''    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.AUTH_PROVIDER = "SUPABASE";''',
)
test_content = test_content.replace(
    '''    process.env.SUPABASE_KEY = originalEnv.SUPABASE_KEY;
  });''',
    '''    process.env.SUPABASE_KEY = originalEnv.SUPABASE_KEY;
    if (originalEnv.AUTH_PROVIDER === undefined) delete process.env.AUTH_PROVIDER;
    else process.env.AUTH_PROVIDER = originalEnv.AUTH_PROVIDER;
  });''',
)
test_path.write_text(test_content, encoding="utf-8")
