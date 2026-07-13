import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "client/src/components/ui/state-surface.tsx");

describe("StateSurface visual-state contract", () => {
  const source = readFileSync(sourcePath, "utf8");

  it.each(["loading", "empty", "error", "offline", "stale", "reconnecting", "success"])(
    "supports the %s state",
    (state) => {
      expect(source).toMatch(new RegExp(`\\b${state}:\\s*["']`));
    },
  );

  it("announces changing connection and loading states without making every empty state an alert", () => {
    expect(source).toContain('role={kind === "error" ? "alert" : "status"}');
    expect(source).toContain('aria-live={kind === "error" ? "assertive" : "polite"}');
  });

  it("uses reduced-motion-safe loading treatment and optional retry actions", () => {
    expect(source).toContain("motion-reduce:animate-none");
    expect(source).toContain("actionLabel");
    expect(source).toContain("onAction");
  });
});
