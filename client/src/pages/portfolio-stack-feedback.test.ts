import { describe, expect, it } from "vitest";

import { formatStackToastMessage } from "@/pages/portfolio-stack-feedback";

describe("formatStackToastMessage", () => {
  it("formats the preferred shares/stack power message", () => {
    const message = formatStackToastMessage({
      singlesStacked: 4,
      newStackPower: 10,
    });

    expect(message).toBe("Stacked 4 shares. Stack is now 10p.");
  });

  it("uses power fallback fields when singles are not provided", () => {
    const message = formatStackToastMessage({
      powerAdded: 2,
      stackPower: 8,
    });

    expect(message).toBe("Added 2p. Stack is now 8p.");
  });

  it("never emits undefined/NaN/blank output", () => {
    const message = formatStackToastMessage({});

    expect(message).toBe("Stack updated successfully.");
    expect(message.toLowerCase()).not.toContain("undefined");
    expect(message.toLowerCase()).not.toContain("nan");
    expect(message.trim().length).toBeGreaterThan(0);
  });
});
