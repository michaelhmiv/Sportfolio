import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = (name: string) =>
  readFileSync(resolve(process.cwd(), "client/src/components", name), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const headerSource = appSource.slice(
  appSource.indexOf("function Header()"),
  appSource.indexOf("function GlobalBoostCeremonyManager()"),
);

describe("application shell visual contract", () => {
  it("desktop and mobile navigation consume the shared route map", () => {
    const sidebar = component("app-sidebar.tsx");
    const bottom = component("bottom-nav.tsx");

    expect(sidebar).toContain("APP_NAV_ITEMS");
    expect(sidebar).toContain("isAppRouteActive");
    expect(bottom).toContain("MOBILE_NAV_ITEM_IDS");
    expect(bottom).toContain("getAppNavItem");
  });

  it("mobile market selection uses local SVG sport icons and no emoji glyphs", () => {
    const source = component("bottom-nav.tsx");
    expect(source).toContain("SportIcon");
    expect(source).not.toMatch(/[🏀🏈⚾🏎🏒🌎]/u);
  });

  it("navigation status uses semantic tones instead of hardcoded palettes", () => {
    const source = `${component("app-sidebar.tsx")}\n${component("bottom-nav.tsx")}`;
    expect(source).toContain("text-premium");
    expect(source).toContain("bg-boost");
    expect(source).not.toMatch(/(?:bg|text|border)-(?:yellow|red|blue)-\d+/);
  });

  it("mobile navigation exposes current-page state and 44px touch targets", () => {
    const source = component("bottom-nav.tsx");
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
    expect(source).toMatch(/min-h-(?:11|\[44px\])/);
  });

  it("connection banners use explicit semantic states and reduced-motion fallbacks", () => {
    const source = `${component("connection-status.tsx")}\n${component("offline-banner.tsx")}`;
    expect(source).toContain("bg-reconnecting-subtle");
    expect(source).toContain("bg-offline-subtle");
    expect(source).toContain("motion-reduce:animate-none");
  });

  it("header and footer use the same semantic shell hierarchy", () => {
    const footer = component("footer.tsx");
    const source = `${headerSource}\n${footer}`;
    expect(headerSource).toContain("bg-sidebar/95");
    expect(headerSource).toContain("border-b-premium/30");
    expect(headerSource).toContain("bg-status-live");
    expect(footer).toContain("border-border-subtle");
    expect(footer).toContain("text-content-muted");
    expect(source).not.toMatch(/(?:bg|text|border)-(?:yellow|red)-\d+/);
  });
});
