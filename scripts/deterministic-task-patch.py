from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str, count: int = -1) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if old not in content:
        raise SystemExit(f"Expected patch anchor missing in {path}: {old[:100]!r}")
    target.write_text(content.replace(old, new, count), encoding="utf-8")


replace(
    "server/auth/config.ts",
    "    BETTER_AUTH_URL: optionalUrl,\n    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),",
    "    BETTER_AUTH_URL: optionalUrl,\n    BETTER_AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),\n    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),",
)
replace(
    "server/auth/config.ts",
    '''    const publicHost = new URL(value.PUBLIC_SITE_URL).hostname;
    const sharedProductionDatabase =''',
    '''    const publicHost = new URL(value.PUBLIC_SITE_URL).hostname.toLowerCase();
    const authHost = value.BETTER_AUTH_URL
      ? new URL(value.BETTER_AUTH_URL).hostname.toLowerCase()
      : null;
    const cookieDomain = value.BETTER_AUTH_COOKIE_DOMAIN
      ?.trim()
      .replace(/^\\./, "")
      .toLowerCase();
    const hostMatchesCookieDomain = (host: string) =>
      Boolean(cookieDomain && (host === cookieDomain || host.endsWith(`.${cookieDomain}`)));
    const sharedProductionDatabase =''',
)
replace(
    "server/auth/config.ts",
    '''    if (betterAuthEnabled && !value.BETTER_AUTH_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_URL"],
        message: "required when Better Auth is active",
      });
    }

    if (value.AUTH_MAGIC_LINK_ENABLED) {''',
    '''    if (betterAuthEnabled && !value.BETTER_AUTH_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_URL"],
        message: "required when Better Auth is active",
      });
    }
    if (betterAuthEnabled && authHost && authHost !== publicHost && !cookieDomain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_COOKIE_DOMAIN"],
        message: "required when Better Auth and the application use separate subdomains",
      });
    }
    if (
      cookieDomain &&
      (!hostMatchesCookieDomain(publicHost) || (authHost && !hostMatchesCookieDomain(authHost)))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_COOKIE_DOMAIN"],
        message: "must be a shared parent domain of the application and Better Auth hosts",
      });
    }

    if (value.AUTH_MAGIC_LINK_ENABLED) {''',
)

replace(
    "server/auth/better-auth.ts",
    '''    advanced: { cookiePrefix: "sportfolio", useSecureCookies: config.NODE_ENV === "production" },''',
    '''    advanced: {
      cookiePrefix: "sportfolio",
      useSecureCookies: config.NODE_ENV === "production",
      ...(config.BETTER_AUTH_COOKIE_DOMAIN
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: config.BETTER_AUTH_COOKIE_DOMAIN,
            },
          }
        : {}),
    },''',
)

# Every test configuration that intentionally splits auth.sportfolio.market from the
# application host must declare the same cookie boundary required in production.
for test_path in (ROOT / "server" / "auth").glob("*.test.ts"):
    content = test_path.read_text(encoding="utf-8")
    anchor = '    BETTER_AUTH_URL: "https://auth.sportfolio.market",\n'
    if anchor in content and "BETTER_AUTH_COOKIE_DOMAIN" not in content:
        content = content.replace(
            anchor,
            anchor + '    BETTER_AUTH_COOKIE_DOMAIN: ".sportfolio.market",\n',
        )
        test_path.write_text(content, encoding="utf-8")

config_test = ROOT / "server/auth/config.test.ts"
content = config_test.read_text(encoding="utf-8")
anchor = '''  it("requires Better Auth secrets when Better Auth is active", () => {
    expect(() => authEnvironmentSchema.parse({ ...base, AUTH_PROVIDER: "DUAL" })).toThrow();
  });
'''
addition = anchor + '''
  it("requires and validates a shared cookie domain for the dedicated auth host", () => {
    const dual = {
      ...base,
      AUTH_PROVIDER: "DUAL",
      BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
      BETTER_AUTH_URL: "https://auth.sportfolio.market",
    };
    expect(() => authEnvironmentSchema.parse(dual)).toThrow(
      "required when Better Auth and the application use separate subdomains",
    );
    expect(() =>
      authEnvironmentSchema.parse({
        ...dual,
        BETTER_AUTH_COOKIE_DOMAIN: ".sportfolio.market",
      }),
    ).not.toThrow();
    expect(() =>
      authEnvironmentSchema.parse({
        ...dual,
        BETTER_AUTH_COOKIE_DOMAIN: ".example.com",
      }),
    ).toThrow("must be a shared parent domain");
  });
'''
if "requires and validates a shared cookie domain" not in content:
    if anchor not in content:
        raise SystemExit("Config test insertion anchor missing")
    config_test.write_text(content.replace(anchor, addition, 1), encoding="utf-8")

for doc_path in [
    ROOT / "docs/auth/passwordless-web-dual-auth.md",
    ROOT / "docs/auth/better-auth-server-foundation.md",
]:
    if not doc_path.exists():
        continue
    doc = doc_path.read_text(encoding="utf-8").rstrip()
    note = (
        "\n\nBecause the canonical auth endpoint and application use sibling subdomains, "
        "`BETTER_AUTH_COOKIE_DOMAIN=.sportfolio.market` is required during activation. "
        "Better Auth then shares only its signed HttpOnly session cookies across the approved "
        "Sportfolio subdomains; trusted-origin and CSRF validation remain enabled.\n"
    )
    if "BETTER_AUTH_COOKIE_DOMAIN=.sportfolio.market" not in doc:
        doc_path.write_text(doc + note, encoding="utf-8")
