import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicSurfaces = [
  "pages/landing.tsx",
  "pages/Login.tsx",
  "pages/passwordless-web-login.tsx",
  "pages/auth-complete.tsx",
  "pages/auth-error.tsx",
  "pages/checkout-success.tsx",
  "pages/onboarding.tsx",
  "pages/wiki.tsx",
  "pages/wiki-article.tsx",
  "pages/blog.tsx",
  "pages/blog-post.tsx",
  "pages/news.tsx",
  "pages/about.tsx",
  "pages/contact.tsx",
  "pages/how-it-works.tsx",
  "pages/terms.tsx",
  "pages/privacy.tsx",
  "pages/account-deletion.tsx",
  "pages/discord-link.tsx",
  "pages/not-found.tsx",
  "pages/admin.tsx",
  "pages/user-profile.tsx",
] as const;

const source = (file: string) => readFileSync(resolve(process.cwd(), "client/src", file), "utf8");

const hardcodedPalette =
  /(?:bg|text|border|ring|fill|stroke|shadow|from|via|to)-(?:amber|black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow|zinc)(?:-[0-9]+)?(?:\/[\d.\[\]]+)?/g;
const hardcodedHex = /#[\da-f]{3,8}\b/gi;
const hardcodedRadius =
  /(?:\brounded(?!-)\b|\brounded-\[[^\]]+\]|\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b)/g;
const emoji = /\p{Extended_Pictographic}/u;

const findings = (pattern: RegExp, value: string) => value.match(pattern) ?? [];

describe("public-auth-editorial visual-system contract", () => {
  it.each(publicSurfaces)("keeps %s on semantic colors and shapes", (file) => {
    const contents = source(file);
    expect(findings(hardcodedPalette, contents)).toEqual([]);
    expect(findings(hardcodedHex, contents)).toEqual([]);
    expect(findings(hardcodedRadius, contents)).toEqual([]);
    expect(contents).not.toMatch(emoji);
  });

  it("preserves the auth error page deep-link contract", () => {
    const contents = source("pages/auth-error.tsx");
    expect(contents).toContain('data-testid="text-error-title"');
    expect(contents).toContain('data-testid="text-error-code"');
    expect(contents).toContain("This sign-in link has expired");
  });

  it("preserves the passwordless Better Auth login contract", () => {
    const login = source("pages/Login.tsx");
    const passwordless = source("pages/passwordless-web-login.tsx");

    expect(login).toContain("PasswordlessWebLogin");
    expect(passwordless).toContain('data-testid="input-passwordless-email"');
    expect(passwordless).toContain('data-testid="button-passwordless-submit"');
    expect(passwordless).toContain("requestMagicLink");
    expect(passwordless).toContain("Email me a sign-in link");
  });

  it("maps passwordless completion failures without the retired Supabase callback", () => {
    const contents = source("pages/auth-complete.tsx");
    expect(contents).toContain("/api/auth/web/complete?continuation=");
    expect(contents).toContain('credentials: "include"');
    expect(contents).toContain('response.status === 410 ? "expired" : "invalid"');
    expect(contents).toContain('broadcastWebAuthChange("signed-in")');
  });
});
