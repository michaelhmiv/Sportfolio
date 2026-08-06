from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str, count: int = -1) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if old not in content:
        raise SystemExit(f"Expected patch anchor missing in {path}: {old[:100]!r}")
    target.write_text(content.replace(old, new, count), encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


replace(
    "server/auth/web-auth.ts",
    '''const requestSchema = z.object({
  email: z.string().trim().email().max(320),
  returnTo: z.string().max(2048).optional(),
});
''',
    '''const requestSchema = z.object({
  email: z.string().trim().email().max(320),
  returnTo: z.string().max(2048).optional(),
});

export const AUTH_CAPABILITIES_PATH = "/api/auth/capabilities";

export function getPublicAuthCapabilities(env: NodeJS.ProcessEnv = process.env) {
  const rawProvider = (env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();
  const provider = rawProvider === "DUAL" || rawProvider === "BETTER_AUTH" ? rawProvider : "SUPABASE";
  const magicLinkEnabled = env.AUTH_MAGIC_LINK_ENABLED === "true";
  return {
    passwordlessWeb: provider !== "SUPABASE" && magicLinkEnabled,
    nativeHandoff:
      provider !== "SUPABASE" &&
      magicLinkEnabled &&
      env.AUTH_NATIVE_HANDOFF_ENABLED === "true",
  };
}

function registerAuthCapabilitiesRoute(app: Express): void {
  app.get(AUTH_CAPABILITIES_PATH, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getPublicAuthCapabilities());
  });
}
''',
)
replace(
    "server/auth/web-auth.ts",
    '''export function registerWebAuthRoutes(app: Express, config?: AuthRuntimeConfig): boolean {
  const rawProvider = (process.env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();''',
    '''export function registerWebAuthRoutes(app: Express, config?: AuthRuntimeConfig): boolean {
  registerAuthCapabilitiesRoute(app);
  const rawProvider = (process.env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();''',
)

write(
    "client/src/lib/auth-capabilities.ts",
    '''export type PublicAuthCapabilities = {
  passwordlessWeb: boolean;
  nativeHandoff: boolean;
};

const legacyFallback: PublicAuthCapabilities = {
  passwordlessWeb: false,
  nativeHandoff: false,
};

let cachedRequest: Promise<PublicAuthCapabilities> | null = null;

export function resetAuthCapabilitiesCacheForTests(): void {
  cachedRequest = null;
}

export function fetchAuthCapabilities(): Promise<PublicAuthCapabilities> {
  cachedRequest ??= fetch("/api/auth/capabilities", {
    credentials: "include",
    headers: { accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) return legacyFallback;
      const payload = (await response.json()) as Partial<PublicAuthCapabilities>;
      return {
        passwordlessWeb: payload.passwordlessWeb === true,
        nativeHandoff: payload.nativeHandoff === true,
      };
    })
    .catch(() => legacyFallback);
  return cachedRequest;
}
''',
)

replace(
    "client/src/pages/Login.tsx",
    'import PasswordlessWebLogin from "@/pages/passwordless-web-login";',
    'import PasswordlessWebLogin from "@/pages/passwordless-web-login";\nimport { fetchAuthCapabilities } from "@/lib/auth-capabilities";',
)
replace(
    "client/src/pages/Login.tsx",
    '''  const [signupSuccessEmail, setSignupSuccessEmail] = useState<string | null>(null);

  // Ref that holds the browserFinished listener''',
    '''  const [signupSuccessEmail, setSignupSuccessEmail] = useState<string | null>(null);
  const [passwordlessWebEnabled, setPasswordlessWebEnabled] = useState<boolean | null>(
    isNative ? false : null,
  );

  useEffect(() => {
    if (isNative) return;
    let active = true;
    void fetchAuthCapabilities().then((capabilities) => {
      if (active) setPasswordlessWebEnabled(capabilities.passwordlessWeb);
    });
    return () => {
      active = false;
    };
  }, [isNative]);

  // Ref that holds the browserFinished listener''',
)
replace(
    "client/src/pages/Login.tsx",
    '''  if (!isNative) {
    return <PasswordlessWebLogin />;
  }

  if (authLoading) {''',
    '''  if (!isNative && passwordlessWebEnabled === true) {
    return <PasswordlessWebLogin />;
  }

  if (authLoading || (!isNative && passwordlessWebEnabled === null)) {''',
)

replace(
    "server/auth/web-auth.test.ts",
    'import { normalizeWebAuthDestination } from "./web-auth";',
    'import { getPublicAuthCapabilities, normalizeWebAuthDestination } from "./web-auth";',
)
replace(
    "server/auth/web-auth.test.ts",
    '''describe("passwordless web continuation policy", () => {
  it("preserves internal destinations", () => {''',
    '''describe("passwordless web continuation policy", () => {
  it("keeps passwordless UI disabled until both provider and feature flag are active", () => {
    expect(getPublicAuthCapabilities({ AUTH_PROVIDER: "SUPABASE", AUTH_MAGIC_LINK_ENABLED: "true" }).passwordlessWeb).toBe(false);
    expect(getPublicAuthCapabilities({ AUTH_PROVIDER: "DUAL", AUTH_MAGIC_LINK_ENABLED: "false" }).passwordlessWeb).toBe(false);
    expect(getPublicAuthCapabilities({ AUTH_PROVIDER: "DUAL", AUTH_MAGIC_LINK_ENABLED: "true" }).passwordlessWeb).toBe(true);
  });

  it("preserves internal destinations", () => {''',
)

replace(
    "client/src/lib/passwordless-auth.contract.test.ts",
    '''    expect(login).toContain("PasswordlessWebLogin");
    expect(app).toContain('path="/auth/complete"');''',
    '''    expect(login).toContain("PasswordlessWebLogin");
    expect(login).toContain("fetchAuthCapabilities");
    expect(login).toContain("passwordlessWebEnabled === true");
    expect(app).toContain('path="/auth/complete"');''',
)

for doc_path in [
    ROOT / "docs/auth/passwordless-web-dual-auth.md",
    ROOT / "docs/auth/better-auth-server-foundation.md",
]:
    if not doc_path.exists():
        continue
    doc = doc_path.read_text(encoding="utf-8").rstrip()
    note = (
        "\n\nThe web login surface is capability-gated by `/api/auth/capabilities`. "
        "When Railway remains on `AUTH_PROVIDER=SUPABASE` or magic links are disabled, "
        "the existing Supabase login UI remains active. The passwordless UI is exposed only "
        "after the server reports the replacement path as enabled.\n"
    )
    if "capability-gated by `/api/auth/capabilities`" not in doc:
        doc_path.write_text(doc + note, encoding="utf-8")
