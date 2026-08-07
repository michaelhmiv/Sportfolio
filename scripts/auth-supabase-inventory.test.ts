import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySupabasePath,
  collectSupabaseInventory,
  renderSupabaseInventory,
} from "./auth-supabase-inventory";

describe("Supabase exit inventory", () => {
  it("classifies current dependency surfaces deterministically", () => {
    expect(classifySupabasePath("client/src/lib/supabase.ts")).toBe("client-auth");
    expect(classifySupabasePath("server/supabaseAuth.ts")).toBe("server-auth");
    expect(classifySupabasePath("server/services/account-deletion.ts")).toBe("account-lifecycle");
    expect(classifySupabasePath("scripts/plugin-oauth-discovery-check.ts")).toBe("oauth-mcp");
    expect(classifySupabasePath("README.md")).toBe("documentation");
    expect(classifySupabasePath("docs/auth/best-practices.md")).toBe("documentation");
    expect(classifySupabasePath(".claude/settings.local.json")).toBe("configuration");
    expect(classifySupabasePath("migrations/example.sql")).toBe("database-security");
    expect(classifySupabasePath("unknown/new-supabase-bridge.ts")).toBeNull();
  });

  it("detects an unclassified reference", () => {
    const root = mkdtempSync(join(tmpdir(), "sportfolio-auth-inventory-"));
    mkdirSync(join(root, "unknown"), { recursive: true });
    writeFileSync(
      join(root, "unknown", "bridge.ts"),
      'const issuer = "https://example.supabase.co/auth/v1";',
    );
    const result = collectSupabaseInventory(root);
    expect(result.unclassified).toEqual(["unknown/bridge.ts"]);
  });

  it("renders the repository inventory with no unclassified references", () => {
    const result = collectSupabaseInventory();
    expect(result.unclassified).toEqual([]);
    expect(result.entries.length).toBeGreaterThan(0);
    const report = renderSupabaseInventory(result.entries);
    expect(report).toContain("Railway Postgres remains authoritative");
    expect(report).toContain("server/supabaseAuth.ts");
  });
});
