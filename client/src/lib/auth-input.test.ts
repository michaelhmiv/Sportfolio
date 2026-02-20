import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "./auth-input";

describe("auth-input", () => {
  it("normalizes email by trimming and lowercasing", () => {
    expect(normalizeEmail("  My.User+Test@Example.COM  ")).toBe("my.user+test@example.com");
  });

  it("accepts valid email formats", () => {
    expect(isValidEmail("person@example.com")).toBe(true);
    expect(isValidEmail("  person+tag@sub.example.co ")).toBe(true);
  });

  it("rejects malformed email formats", () => {
    expect(isValidEmail("plainaddress")).toBe(false);
    expect(isValidEmail("person@localhost")).toBe(false);
    expect(isValidEmail("person@@example.com")).toBe(false);
  });
});
