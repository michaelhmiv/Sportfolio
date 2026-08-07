from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

routes_path = ROOT / "server/routes.ts"
routes = routes_path.read_text(encoding="utf-8")
routes = routes.replace(
    'method: "token" | "dev_bypass" | "supabase_jwt" | "session",',
    'method: "token" | "dev_bypass" | "session",',
)
routes, count = re.subn(
    r'\n    // Check 3: Verify Supabase JWT token and check isAdmin flag\n.*?\n    // Check 4: Fallback - check if req\.user is already set \(from session or other middleware\)',
    '\n    // Check 3: Check if req.user is already set by Better Auth or native auth middleware',
    routes,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"expected one legacy admin JWT block, replaced {count}")
routes = routes.replace(
    '            hasSupabaseUrl: !!process.env.SUPABASE_URL,\n            hasSupabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,',
    '            hasBetterAuthSecret: !!process.env.BETTER_AUTH_SECRET,\n            hasResendApiKey: !!process.env.RESEND_API_KEY,',
)
routes_path.write_text(routes, encoding="utf-8")

plugin_path = ROOT / "scripts/plugin-oauth-discovery-check.ts"
plugin = plugin_path.read_text(encoding="utf-8")
plugin = plugin.replace(
    '''  const issuer =\n    process.env.PLUGIN_OAUTH_ISSUER?.trim() ||\n    (process.env.SUPABASE_URL?.trim()\n      ? `${process.env.SUPABASE_URL.trim().replace(/\\/$/, "")}/auth/v1`\n      : "");\n\n  if (!issuer) {\n    throw new Error("Set PLUGIN_OAUTH_ISSUER or SUPABASE_URL before running the OAuth probe.");\n  }''',
    '''  const issuer =\n    process.env.PLUGIN_OAUTH_ISSUER?.trim() || process.env.BETTER_AUTH_URL?.trim() || "";\n\n  if (!issuer) {\n    throw new Error("Set PLUGIN_OAUTH_ISSUER or BETTER_AUTH_URL before running the OAuth probe.");\n  }''',
)
if "SUPABASE_" in plugin or "supabase" in plugin.lower():
    raise SystemExit("plugin OAuth probe still contains legacy provider references")
plugin_path.write_text(plugin, encoding="utf-8")

use_auth_test = ROOT / "client/src/hooks/useAuth.test.ts"
source = use_auth_test.read_text(encoding="utf-8")
source = source.replace('    expect(source).not.toContain("@supabase/supabase-js");\n', '')
use_auth_test.write_text(source, encoding="utf-8")

account_test = ROOT / "server/services/account-deletion.test.ts"
account_test.write_text('''import {\n  accountDeletionRequests,\n  authIdentities,\n  authUsers,\n  userBadgePreferences,\n  userFeaturedCollections,\n  userPushDevices,\n  userPushTokens,\n  users,\n  type AccountDeletionRequest,\n} from "@shared/schema";\nimport { beforeEach, describe, expect, it, vi } from "vitest";\n\nconst mocks = vi.hoisted(() => ({\n  db: {} as Record<string, unknown>,\n  deletedTables: [] as unknown[],\n}));\n\nvi.mock("../db", () => ({ db: mocks.db }));\nvi.mock("../lib/logger", () => ({\n  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },\n}));\n\nimport { processDueAccountDeletionRequests } from "./account-deletion";\n\nfunction buildRequest(overrides: Partial<AccountDeletionRequest> = {}): AccountDeletionRequest {\n  return {\n    id: "deletion-request-1",\n    userId: "user-account-delete",\n    status: "pending",\n    reason: null,\n    details: null,\n    requestedAt: new Date("2026-07-14T10:00:00.000Z"),\n    effectiveAt: new Date("2026-07-15T10:00:00.000Z"),\n    cancelledAt: null,\n    processedAt: null,\n    retainedRecordsNote: null,\n    metadata: {},\n    ...overrides,\n  };\n}\n\nfunction selectChain(result: unknown[]) {\n  const chain: any = {\n    from: vi.fn(() => chain),\n    where: vi.fn(() => chain),\n    orderBy: vi.fn(() => chain),\n    limit: vi.fn(() => Promise.resolve(result)),\n    for: vi.fn(() => Promise.resolve(result)),\n    then: (resolve: (value: unknown[]) => unknown, reject: (reason?: unknown) => unknown) =>\n      Promise.resolve(result).then(resolve, reject),\n  };\n  return chain;\n}\n\nfunction updateChain(returned: unknown[] = []) {\n  const chain: any = {\n    set: vi.fn(() => chain),\n    where: vi.fn(() => chain),\n    returning: vi.fn(() => Promise.resolve(returned)),\n  };\n  return chain;\n}\n\ndescribe("account deletion processor", () => {\n  beforeEach(() => {\n    vi.clearAllMocks();\n    mocks.deletedTables.length = 0;\n\n    const request = buildRequest();\n    const processingRequest = buildRequest({ status: "provider_cleanup_pending" });\n    const completedRequest = buildRequest({ status: "completed" });\n    const user = {\n      id: request.userId,\n      email: "delete@example.com",\n      username: "deleteme",\n      authProviderSubject: request.userId,\n      authProviderSubjects: [request.userId],\n      deletedAt: null,\n    };\n\n    const tx = {\n      select: vi\n        .fn()\n        .mockImplementationOnce(() => selectChain([request]))\n        .mockImplementationOnce(() => selectChain([user])),\n      update: vi.fn((table: unknown) =>\n        updateChain(table === accountDeletionRequests ? [processingRequest] : []),\n      ),\n      delete: vi.fn((table: unknown) => {\n        mocks.deletedTables.push(table);\n        return { where: vi.fn(() => Promise.resolve()) };\n      }),\n    };\n\n    let selectCall = 0;\n    Object.assign(mocks.db, {\n      select: vi.fn(() => {\n        selectCall += 1;\n        return selectCall === 1\n          ? selectChain([request])\n          : selectChain([{ authUserId: "better-auth-user-1" }]);\n      }),\n      transaction: vi.fn((callback: (executor: typeof tx) => unknown) => callback(tx)),\n      delete: vi.fn((table: unknown) => {\n        mocks.deletedTables.push(table);\n        return { where: vi.fn(() => Promise.resolve()) };\n      }),\n      update: vi.fn((table: unknown) =>\n        updateChain(table === accountDeletionRequests ? [completedRequest] : []),\n      ),\n    });\n  });\n\n  it("erases local data and deletes the mapped Better Auth identity", async () => {\n    const result = await processDueAccountDeletionRequests(new Date("2026-07-15T11:00:00.000Z"));\n\n    expect(result).toEqual({ scanned: 1, completed: 1, failed: 0 });\n    expect(mocks.deletedTables).toContain(userBadgePreferences);\n    expect(mocks.deletedTables).toContain(userFeaturedCollections);\n    expect(mocks.deletedTables).toContain(userPushDevices);\n    expect(mocks.deletedTables).toContain(userPushTokens);\n    expect(mocks.deletedTables).toContain(authUsers);\n    expect(mocks.deletedTables).not.toContain(authIdentities);\n\n    const transaction = mocks.db.transaction as ReturnType<typeof vi.fn>;\n    expect(transaction).toHaveBeenCalledOnce();\n\n    const update = mocks.db.update as ReturnType<typeof vi.fn>;\n    expect(update).toHaveBeenCalledWith(accountDeletionRequests);\n    expect(update).not.toHaveBeenCalledWith(users);\n  });\n});\n''', encoding="utf-8")

for legacy in [ROOT / "scripts/debug-eligible-players.ts", ROOT / "scripts/verify-anon-access.js"]:
    if legacy.exists():
        legacy.unlink()

# The retired-surface scanner intentionally names retired prefixes; it is governance, not runtime.
audit = ROOT / "scripts/audit-retired-runtime.mjs"
audit_source = audit.read_text(encoding="utf-8")
audit_source = audit_source.replace(
    'const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);',
    'const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);\nconst ignoredFiles = new Set(["scripts/audit-retired-runtime.mjs", "scripts/audit-retired-surfaces.mjs"]);',
)
audit_source = audit_source.replace(
    '    if (!extensions.has(path.extname(entry.name))) continue;',
    '    if (!extensions.has(path.extname(entry.name))) continue;\n    const relativePath = path.relative(process.cwd(), fullPath).replaceAll("\\\\", "/");\n    if (ignoredFiles.has(relativePath)) continue;',
)
audit.write_text(audit_source, encoding="utf-8")
'''
