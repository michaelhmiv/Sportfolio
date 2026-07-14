import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(process.cwd(), "client/src/components/ui");
const readUi = (file: string) => readFileSync(resolve(uiRoot, file), "utf8");

const focusableControlFiles = [
  "checkbox.tsx",
  "input-otp.tsx",
  "radio-group.tsx",
  "resizable.tsx",
  "slider.tsx",
  "switch.tsx",
  "tabs.tsx",
  "textarea.tsx",
  "toast.tsx",
  "toggle.tsx",
];

describe("shared control visual-system contract", () => {
  it.each(focusableControlFiles)("%s uses the semantic focus token", (file) => {
    const source = readUi(file);
    expect(source).not.toContain("ring-ring");
    expect(source).toContain("ring-focus");
  });

  it("textarea uses semantic surface, text, placeholder, and disabled tokens", () => {
    const source = readUi("textarea.tsx");
    expect(source).toContain("bg-surface");
    expect(source).toContain("text-content");
    expect(source).toContain("placeholder:text-content-subtle");
    expect(source).toContain("disabled:bg-disabled");
  });

  it("toast uses semantic surfaces and no hardcoded red palette utilities", () => {
    const source = readUi("toast.tsx");
    expect(source).toContain("bg-overlay");
    expect(source).toContain("shadow-overlay");
    expect(source).not.toMatch(/(?:text|bg|ring|border)-red-/);
  });

  it("progress uses semantic track, indicator, and radius tokens", () => {
    const source = readUi("progress.tsx");
    expect(source).toContain("bg-border-subtle");
    expect(source).toContain("bg-brand");
    expect(source).toContain("rounded-pill");
  });

  it("loading buttons use semantic feedback colors and honor reduced motion", () => {
    const source = readUi("loading-button.tsx");
    expect(source).toContain("bg-market-positive");
    expect(source).toContain("bg-destructive");
    expect(source).toContain("disabled:bg-market-positive");
    expect(source).toContain("disabled:bg-destructive");
    expect(source).toContain("useReducedMotion");
    expect(source).toContain("if (shouldReduceMotion)");
    expect(source).not.toMatch(/(?:text|bg|ring|border)-(?:red|emerald)-/);
  });
});
