import { describe, expect, it } from "vitest";
import { sanitizeRequestHeaders, serializeRequestForLog } from "./request-log-sanitizer";

describe("request log privacy", () => {
  it("redacts auth, cookie, OpenAI session/subject, token, key, and secret headers", () => {
    const headers = sanitizeRequestHeaders({
      authorization: "Bearer secret-token",
      cookie: "session=abc",
      "openai-session-id": "session-secret",
      "openai-subject": "subject-secret",
      "x-api-key": "api-secret",
      "x-auth-token": "token-secret",
      "mcp-method": "tools/list",
      "user-agent": "test-agent",
    });
    const serialized = JSON.stringify(headers);
    for (const secret of ["secret-token", "session=abc", "session-secret", "subject-secret", "api-secret", "token-secret"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(headers["mcp-method"]).toBe("tools/list");
    expect(headers["user-agent"]).toBe("test-agent");
  });

  it("keeps operational request fields while sanitizing headers", () => {
    expect(
      serializeRequestForLog({
        id: "req-1",
        method: "POST",
        url: "/mcp",
        headers: { "mcp-protocol-version": "2026-07-28", "chatgpt-subject": "private" },
      }),
    ).toMatchObject({
      id: "req-1",
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": "2026-07-28", "chatgpt-subject": "[Redacted]" },
    });
  });
});
