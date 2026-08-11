import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  APP_NAV_ITEMS,
  MOBILE_NAV_ITEM_IDS,
  getAppNavItem,
  isAppRouteActive,
} from "@/lib/app-navigation";
import { SPORT_ICON_SPORTS, SportIcon } from "@/components/sport-icon";

describe("shared application navigation", () => {
  it("owns one unique route record for every shell destination", () => {
    const ids = APP_NAV_ITEMS.map((item) => item.id);
    const paths = APP_NAV_ITEMS.map((item) => item.href);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(MOBILE_NAV_ITEM_IDS).toEqual(["dashboard", "pools", "boosts", "portfolio", "analytics"]);
  });

  it("provides the same labels and icons to desktop and mobile consumers", () => {
    for (const id of MOBILE_NAV_ITEM_IDS) {
      const item = getAppNavItem(id);
      expect(item.label.length).toBeGreaterThan(0);
      expect(renderToStaticMarkup(<item.icon aria-hidden="true" />)).toContain("<svg");
    }
  });

  it("keeps the dashboard exact while nested destination routes stay active", () => {
    expect(isAppRouteActive("/", "/")).toBe(true);
    expect(isAppRouteActive("/player/42", "/")).toBe(false);
    expect(isAppRouteActive("/pools", "/pools")).toBe(true);
    expect(isAppRouteActive("/pools/nba", "/pools")).toBe(true);
  });
});

describe("sport icon system", () => {
  it("renders every supported market as local accessible SVG without emoji glyphs", () => {
    expect(SPORT_ICON_SPORTS).toEqual(["NBA", "NFL", "MLB", "NHL", "NASCAR", "ALL"]);

    for (const sport of SPORT_ICON_SPORTS) {
      const markup = renderToStaticMarkup(<SportIcon sport={sport} title={`${sport} market`} />);
      expect(markup).toContain("<svg");
      expect(markup).toContain(`data-sport-icon="${sport}"`);
      expect(markup).toContain(`<title>${sport} market</title>`);
      expect(markup).not.toMatch(/[🏀🏈⚾🏎🏒🌎]/u);
    }
  });
});
