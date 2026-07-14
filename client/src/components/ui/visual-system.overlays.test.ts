import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(process.cwd(), "client/src/components/ui");
const readUi = (file: string) => readFileSync(resolve(uiRoot, file), "utf8");

describe("overlay visual-system contract", () => {
  it.each(["dialog.tsx", "alert-dialog.tsx", "drawer.tsx", "sheet.tsx"])(
    "%s uses the semantic scrim token",
    (file) => {
      expect(readUi(file)).toContain("bg-scrim/");
    },
  );

  it.each(["dialog.tsx", "alert-dialog.tsx", "drawer.tsx", "sheet.tsx", "popover.tsx"])(
    "%s uses overlay surface and elevation tokens",
    (file) => {
      const source = readUi(file);
      expect(source).toContain("bg-overlay");
      expect(source).toContain("shadow-overlay");
    },
  );

  it("tooltip uses an explicit high-contrast semantic pair", () => {
    const source = readUi("tooltip.tsx");
    expect(source).toContain("bg-content");
    expect(source).toContain("text-canvas");
  });

  it.each(["dialog.tsx", "sheet.tsx"])(
    "%s gives its dismiss control a 44px mobile target",
    (file) => {
      const source = readUi(file);
      expect(source).toContain("h-11 w-11");
      expect(source).toContain("sm:h-8 sm:w-8");
    },
  );

  it("toast close has an accessible name and 44px mobile target", () => {
    const source = readUi("toast.tsx");
    expect(source).toContain('aria-label="Dismiss notification"');
    expect(source).toContain("h-11 w-11");
  });
});

describe("form control visual-system contract", () => {
  it.each(["input.tsx", "select.tsx"])("%s exposes a visible semantic focus ring", (file) => {
    const source = readUi(file);
    expect(source).toMatch(/focus(?:-visible)?:ring-2/);
    expect(source).toMatch(/focus(?:-visible)?:ring-focus/);
  });

  it.each(["input.tsx", "select.tsx"])("%s provides a 44px mobile target", (file) => {
    expect(readUi(file)).toContain("h-11");
  });
});
