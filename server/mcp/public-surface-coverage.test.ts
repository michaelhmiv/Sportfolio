import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPublicSiteRouteCoverage,
  evaluateAuthenticatedSiteRouteCoverage,
} from "./public-tool-registry";

const ROUTE_FILES = [
  path.resolve("server/routes.ts"),
  path.resolve("server/routes/amm.ts"),
  path.resolve("server/routes/lp.ts"),
  path.resolve("server/routes/mobile-rewarded-scout-boost.ts"),
  path.resolve("server/routes/sms.ts"),
  path.resolve("server/routes/cli.ts"),
];

function extractAuthenticatedSiteRoutes() {
  const routePattern =
    /app\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,\s*(isAuthenticated|authMiddleware|optionalAuth|adminAuth|requireUserApiToken)/g;
  const routes: Array<{ method: string; path: string }> = [];

  for (const routeFile of ROUTE_FILES) {
    const content = readFileSync(routeFile, "utf8");
    for (const match of content.matchAll(routePattern)) {
      const method = match[1]?.toUpperCase();
      const routePath = match[2];
      const middleware = match[3];

      if (middleware !== "isAuthenticated" && middleware !== "authMiddleware") {
        continue;
      }
      if (!routePath || routePath.startsWith("/api/cli/")) {
        continue;
      }

      routes.push({
        method,
        path: routePath,
      });
    }
  }

  return routes.sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`),
  );
}

describe("public site route coverage", () => {
  it("audits every authenticated non-admin site route against the shared capability catalog", () => {
    const actualRoutes = extractAuthenticatedSiteRoutes();
    const parity = evaluateAuthenticatedSiteRouteCoverage(actualRoutes);

    expect(parity.ok).toBe(true);
    expect(parity.missingFromAudit).toEqual([]);
    expect(parity.extraInAudit).toEqual([]);
    expect(parity.invalidCapabilityRefs).toEqual([]);
    expect(parity.invalidExcludedRefs).toEqual([]);
  });

  it("does not duplicate audited route keys", () => {
    const routeKeys = buildPublicSiteRouteCoverage().map(
      (entry) => `${entry.method} ${entry.path}`,
    );
    expect(new Set(routeKeys).size).toBe(routeKeys.length);
  });
});
