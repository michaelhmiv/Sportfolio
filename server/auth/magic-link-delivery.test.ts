import { describe, expect, it, vi } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import {
  assertSafeMagicLinkUrl,
  createResendMagicLinkSender,
  FixedWindowRateLimiter,
  renderMagicLinkEmail,
} from "./magic-link-delivery";

function config() {
  return getAuthRuntimeConfig({
    NODE_ENV: "test",
    PUBLIC_SITE_URL: "https://beta.sportfolio.market",
    AUTH_PROVIDER: "DUAL",
    AUTH_MAGIC_LINK_ENABLED: "true",
    AUTH_SUPABASE_FALLBACK_ENABLED: "true",
    AUTH_NEW_REGISTRATIONS_ENABLED: "true",
    AUTH_OAUTH_PROVIDER_ENABLED: "false",
    AUTH_NATIVE_HANDOFF_ENABLED: "false",
    AUTH_MIGRATION_MODE: "off",
    AUTH_ENVIRONMENT: "beta",
    AUTH_DATABASE_ENVIRONMENT: "production",
    AUTH_SHARED_PRODUCTION_DATABASE: "true",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://auth.sportfolio.market",
    RESEND_API_KEY: "re_test",
    RESEND_WEBHOOK_SECRET: "whsec_test",
    AUTH_EMAIL_FROM: "Sportfolio <login@auth.sportfolio.market>",
  });
}

describe("magic-link delivery", () => {
  it("enforces fixed-window limits", () => {
    const limiter = new FixedWindowRateLimiter(2, 1000);
    expect(limiter.consume("a", 0)).toBe(true);
    expect(limiter.consume("a", 1)).toBe(true);
    expect(limiter.consume("a", 2)).toBe(false);
    expect(limiter.consume("a", 1001)).toBe(true);
  });
  it("rejects an off-domain generated link or callback", () => {
    expect(() => assertSafeMagicLinkUrl("https://evil.example/token", config())).toThrow(
      "ORIGIN_REJECTED",
    );
    expect(() =>
      assertSafeMagicLinkUrl(
        "https://auth.sportfolio.market/token?callbackURL=https://evil.example",
        config(),
      ),
    ).toThrow("RETURN_ORIGIN_REJECTED");
  });
  it("renders escaped branded content", () => {
    const rendered = renderMagicLinkEmail("https://auth.sportfolio.market/callback?a=1&b=2");
    expect(rendered.html).toContain("Sign in securely");
    expect(rendered.html).toContain("&amp;");
    expect(rendered.text).toContain("expires in 5 minutes");
  });
  it("sends with a token-derived idempotency key without exposing the token", async () => {
    const send = vi.fn().mockResolvedValue({ id: "email-id", error: null });
    const sender = createResendMagicLinkSender(config(), { send, isSuppressed: async () => false });
    await sender({
      email: "USER@example.com",
      url: "https://auth.sportfolio.market/callback?callbackURL=https%3A%2F%2Fbeta.sportfolio.market%2Fportfolio",
      token: "secret-token",
    });
    const call = send.mock.calls[0][0];
    expect(call.to).toEqual(["user@example.com"]);
    expect(call.idempotencyKey).toMatch(/^magic-link\/[a-f0-9]{64}$/);
    expect(call.idempotencyKey).not.toContain("secret-token");
  });
  it("silently accepts suppressed recipients", async () => {
    const send = vi.fn();
    const sender = createResendMagicLinkSender(config(), { send, isSuppressed: async () => true });
    await sender({
      email: "blocked@example.com",
      url: "https://auth.sportfolio.market/callback",
      token: "token",
    });
    expect(send).not.toHaveBeenCalled();
  });
});
