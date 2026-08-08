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
    AUTH_MAGIC_LINK_ENABLED: "true",
    AUTH_NEW_REGISTRATIONS_ENABLED: "true",
    AUTH_OAUTH_PROVIDER_ENABLED: "false",
    AUTH_NATIVE_HANDOFF_ENABLED: "false",
    AUTH_MIGRATION_MODE: "off",
    AUTH_ENVIRONMENT: "beta",
    AUTH_DATABASE_ENVIRONMENT: "production",
    AUTH_SHARED_PRODUCTION_DATABASE: "true",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://beta.sportfolio.market",
    RESEND_API_KEY: "re_test",
    RESEND_WEBHOOK_SECRET: "whsec_test",
    AUTH_EMAIL_FROM: "Sportfolio <login@sportfolio.market>",
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
        "https://beta.sportfolio.market/token?callbackURL=https://evil.example",
        config(),
      ),
    ).toThrow("RETURN_ORIGIN_REJECTED");
  });
  it("renders escaped branded content", () => {
    const rendered = renderMagicLinkEmail(
      "https://beta.sportfolio.market/auth/magic-link?gate=gate-id&a=1",
    );
    expect(rendered.html).toContain("Continue to Sportfolio");
    expect(rendered.html).toContain("&amp;");
    expect(rendered.text).toContain("expires in 5 minutes");
    expect(rendered.text).toContain("confirm that you want to continue");
  });
  it("emails only the scanner-safe gate and keeps a token-derived idempotency key", async () => {
    const send = vi.fn().mockResolvedValue({ id: "email-id", error: null });
    const gateUrl =
      "https://beta.sportfolio.market/auth/magic-link?gate=15f78149-0da4-4d79-9333-933ad24d9ab0";
    const createGate = vi.fn().mockResolvedValue(gateUrl);
    const sender = createResendMagicLinkSender(config(), {
      send,
      createGate,
      isSuppressed: async () => false,
    });
    const verificationUrl =
      "https://beta.sportfolio.market/callback?token=secret-token&callbackURL=https%3A%2F%2Fbeta.sportfolio.market%2Fportfolio";
    await sender({
      email: "USER@example.com",
      url: verificationUrl,
      token: "secret-token",
    });
    const call = send.mock.calls[0][0];
    expect(createGate).toHaveBeenCalledWith(verificationUrl);
    expect(call.to).toEqual(["user@example.com"]);
    expect(call.idempotencyKey).toMatch(/^magic-link\/[a-f0-9]{64}$/);
    expect(call.idempotencyKey).not.toContain("secret-token");
    expect(call.html).toContain(gateUrl.replace("&", "&amp;"));
    expect(call.html).not.toContain("secret-token");
    expect(call.text).not.toContain("secret-token");
  });
  it("silently accepts suppressed recipients without creating a gate", async () => {
    const send = vi.fn();
    const createGate = vi.fn();
    const sender = createResendMagicLinkSender(config(), {
      send,
      createGate,
      isSuppressed: async () => true,
    });
    await sender({
      email: "blocked@example.com",
      url: "https://beta.sportfolio.market/callback",
      token: "token",
    });
    expect(send).not.toHaveBeenCalled();
    expect(createGate).not.toHaveBeenCalled();
  });
});
