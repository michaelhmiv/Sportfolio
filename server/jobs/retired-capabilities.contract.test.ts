import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const retired = [
  "compile_digest",
  "agent_advisory_schedules",
  "agent_live_strategies",
  "agent_strategy_events",
] as const;

describe("retired capability registration contract", () => {
  it("keeps retired jobs out of the canonical scheduler registry", () => {
    const registry = source("server/jobs/job-registry.ts");
    for (const name of retired) expect(registry).not.toContain(`name: "${name}"`);
    expect(registry).not.toContain("../agent/schedules");
    expect(registry).not.toContain("../agent/strategy-runner");
    expect(registry).not.toContain("./compile-digest");
  });

  it("keeps the SMS client route and lazy bundle entry point removed", () => {
    const app = source("client/src/App.tsx");
    expect(app).not.toContain("loadSmsLinkPage");
    expect(app).not.toContain("/sms/link");
    expect(existsSync(resolve(root, "client/src/pages/sms-link.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "client/src/components/sms-access-card.tsx"))).toBe(false);
  });

  it("removes the one-shot Release A workflow", () => {
    expect(existsSync(resolve(root, ".github/workflows/release-a-implementation.yml"))).toBe(false);
  });
});
