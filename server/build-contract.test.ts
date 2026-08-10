import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("production build contract", () => {
  it("typechecks without rebuilding generated UI assets", () => {
    expect(packageJson.scripts.check).toBe("tsc --noEmit");
  });

  it("builds the UI once and emits both web and worker server artifacts", () => {
    expect(packageJson.scripts.build.match(/plugin:ui:build/g)).toHaveLength(1);
    expect(packageJson.scripts.build).toContain("server/index.ts server/worker.ts");
    expect(packageJson.scripts.build).toContain("--outdir=dist");
  });
});
