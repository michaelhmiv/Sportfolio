import { describe, expect, it } from "vitest";
import { normalizePublicError } from "./public-errors";

describe("public MCP error contract", () => {
  it("maps validation failures to a stable machine-readable code", () => {
    expect(
      normalizePublicError({
        name: "PublicMcpToolError",
        code: "invalid_arguments",
        message: "shares is required",
      }),
    ).toEqual({
      code: "invalid_input",
      message: "shares is required",
      retryable: false,
    });
  });

  it("does not leak framework exception groups or arbitrary provider messages", () => {
    expect(
      normalizePublicError(new Error("ExceptionGroup: unhandled errors in a TaskGroup")),
    ).toEqual({
      code: "internal_failure",
      message: "Sportfolio could not complete this request.",
      retryable: false,
    });
  });

  it("distinguishes provider availability and retryable timeouts", () => {
    expect(normalizePublicError({ code: "provider_unavailable" })).toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
    expect(normalizePublicError({ code: "tool_timeout" })).toMatchObject({
      code: "timeout",
      retryable: true,
    });
  });
});
