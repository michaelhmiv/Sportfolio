import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { badgeVariants } from "./badge";
import { buttonVariants } from "./button";

const cardSource = readFileSync(
  resolve(process.cwd(), "client/src/components/ui/card.tsx"),
  "utf8",
);

describe("shared semantic component variants", () => {
  it.each([
    ["marketBuy", "bg-market-positive"],
    ["marketSell", "bg-market-negative"],
    ["premium", "bg-premium"],
    ["terminal", "font-mono"],
    ["terminalOutline", "font-mono"],
  ])("maps the %s button to its semantic contract", (variant, expectedClass) => {
    expect(buttonVariants({ variant } as never)).toContain(expectedClass);
  });

  it.each([
    ["neutral", "bg-surface-raised"],
    ["status", "bg-surface-raised"],
    ["live", "bg-status-live-subtle"],
    ["positive", "bg-market-positive-subtle"],
    ["negative", "bg-market-negative-subtle"],
    ["warning", "bg-status-warning-subtle"],
    ["boost", "bg-boost-subtle"],
    ["premium", "bg-premium-subtle"],
    ["count", "rounded-pill"],
    ["notification", "bg-status-live"],
  ])("maps the %s badge to its semantic contract", (variant, expectedClass) => {
    expect(badgeVariants({ variant } as never)).toContain(expectedClass);
  });

  it.each(["interactive", "dense", "summary", "alert", "live", "premium", "empty"])(
    "declares the %s card family",
    (variant) => {
      expect(cardSource).toMatch(new RegExp(`\\b${variant}:\\s*["']`));
    },
  );
});
