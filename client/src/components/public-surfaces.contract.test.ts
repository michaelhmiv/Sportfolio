import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicSurfaces = [
  "pages/landing.tsx",
  "pages/Login.tsx",
  "pages/AuthCallback.tsx",
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
    expect(contents).toContain("Link Expired");
  });

  it("preserves the login/signup contract for email verification flow", () => {
    const contents = source("pages/Login.tsx");
    expect(contents).toContain('data-testid="button-signup-submit"');
    expect(contents).toContain('data-testid="button-resend-verification"');
    expect(contents).toContain("Verification email sent");
  });

  it("maps auth callback errors to correct deep-link error codes", () => {
    const contents = source("pages/AuthCallback.tsx");
    expect(contents).toContain('redirectToError("link_expired"');
    expect(contents).toContain("pkce_code_verifier_not_found");
    expect(contents).toContain("invalid_grant");
  });
});
