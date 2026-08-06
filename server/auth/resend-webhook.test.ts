import { describe, expect, it } from "vitest";
import { sanitizeResendWebhookPayload, shouldSuppressForEvent } from "./resend-webhook";

describe("Resend webhook policy", () => {
  it("suppresses permanent bounces, complaints, and provider suppressions", () => {
    expect(
      shouldSuppressForEvent({
        type: "email.bounced",
        created_at: new Date().toISOString(),
        data: { bounce: { type: "Permanent" } },
      }),
    ).toBe(true);
    expect(
      shouldSuppressForEvent({ type: "email.complained", created_at: new Date().toISOString() }),
    ).toBe(true);
    expect(
      shouldSuppressForEvent({ type: "email.suppressed", created_at: new Date().toISOString() }),
    ).toBe(true);
    expect(
      shouldSuppressForEvent({
        type: "email.delivery_delayed",
        created_at: new Date().toISOString(),
      }),
    ).toBe(false);
  });
  it("stores only secret-safe delivery metadata", () => {
    const payload = sanitizeResendWebhookPayload({
      type: "email.bounced",
      created_at: new Date().toISOString(),
      data: {
        to: ["private@example.com"],
        bounce: { type: "Permanent", subType: "MessageRejected", message: "private details" },
      },
    });
    expect(payload).toEqual({ bounceType: "Permanent", bounceSubType: "MessageRejected" });
    expect(JSON.stringify(payload)).not.toContain("private@example.com");
    expect(JSON.stringify(payload)).not.toContain("private details");
  });
});
