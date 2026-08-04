import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCurrentCapabilitySnapshot,
  compareCapabilitySnapshots,
  formatSnapshotDiff,
  scanCapabilitySurfaces,
  type CapabilitySnapshot,
} from "../../scripts/public-capability-governance";

const policy = {
  schemaVersion: 1 as const,
  owner: "owner",
  scanPaths: ["server", "dist/public"],
  patterns: [
    { id: "raw", regex: "mlb_mcp__" },
    { id: "sms", regex: "sms-link|get_sms_settings" },
    { id: "alias", regex: "run_hosted_research" },
  ],
  exceptions: [],
};

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "capability-governance-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

describe("public capability governance", () => {
  it("builds a deterministic catalog with output schemas", () => {
    const first = buildCurrentCapabilitySnapshot();
    const second = buildCurrentCapabilitySnapshot();
    expect(first).toEqual(second);
    expect(
      first.entries.filter((entry) => entry.kind === "tool").every((entry) => entry.outputSchema),
    ).toBe(true);
    expect(first.entries.some((entry) => entry.kind === "prompt")).toBe(true);
    expect(first.entries.some((entry) => entry.kind === "resource")).toBe(true);
  });

  it("detects hidden dynamic registration and raw provider aliases", () => {
    const root = fixture({ "server/hidden.ts": 'server.registerTool("mlb_mcp__hidden", {});' });
    expect(scanCapabilitySurfaces(policy, root).violations).toEqual([
      expect.objectContaining({ patternId: "raw", path: "server/hidden.ts" }),
    ]);
  });

  it("detects lazy client route chunks", () => {
    const root = fixture({ "dist/public/assets/sms-link-abc.js": 'const route="sms-link";' });
    expect(scanCapabilitySurfaces(policy, root).violations).toEqual([
      expect.objectContaining({ patternId: "sms", path: "dist/public/assets/sms-link-abc.js" }),
    ]);
  });

  it("detects renamed aliases", () => {
    const root = fixture({ "server/alias.ts": 'const hiddenAlias = "run_hosted_research";' });
    expect(scanCapabilitySurfaces(policy, root).violations).toEqual([
      expect.objectContaining({ patternId: "alias" }),
    ]);
  });

  it("reports auth downgrade and metadata artifact drift", () => {
    const baseline: CapabilitySnapshot = {
      schemaVersion: 1,
      entries: [
        {
          kind: "tool",
          name: "x",
          auth: "oauth",
          readOnly: true,
          destructive: false,
          openWorld: false,
          outputSchema: "v1",
          resourceUri: null,
          domain: "sports_data",
          sportClassification: "multi_sport",
          source: "fixture",
        },
      ],
    };
    const current: CapabilitySnapshot = {
      schemaVersion: 1,
      entries: [
        {
          ...baseline.entries[0],
          auth: "public",
          outputSchema: "v2",
          destructive: true,
        },
      ],
    };
    const diff = compareCapabilitySnapshots(baseline, current);
    expect(diff.authDowngrades).toEqual(["tool:x"]);
    expect(diff.changed[0].fields).toEqual(
      expect.arrayContaining(["auth", "outputSchema", "destructive"]),
    );
    expect(formatSnapshotDiff(diff)).toContain("AUTH DOWNGRADES");
  });

  it("requires owned, unexpired exceptions within match budgets", () => {
    const root = fixture({ "server/legacy.ts": 'const x="mlb_mcp__old";' });
    const exceptedPolicy = {
      ...policy,
      exceptions: [
        {
          patternIds: ["raw"],
          pathRegex: "^server/legacy\\.ts$",
          owner: "owner",
          expiresOn: "2026-08-31",
          reason: "cleanup",
          maxMatches: 1,
        },
      ],
    };
    expect(
      scanCapabilitySurfaces(exceptedPolicy, root, new Date("2026-08-04T00:00:00Z")).violations,
    ).toHaveLength(0);
    expect(
      scanCapabilitySurfaces(exceptedPolicy, root, new Date("2026-09-01T00:00:00Z"))
        .expiredExceptions,
    ).toHaveLength(1);
  });
});
