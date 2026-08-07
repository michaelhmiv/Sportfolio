from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

native_path = ROOT / "server/auth/native-auth.ts"
native = native_path.read_text(encoding="utf-8")
native = native.replace('import type { Express, Request, Response } from "express";', 'import type { Express, Request } from "express";')
native = native.replace('): Promise<Response> {', '): Promise<globalThis.Response> {', 1)
native = native.replace('  ) as unknown as Promise<Response>;', '  ) as unknown as Promise<globalThis.Response>;', 1)
native_path.write_text(native, encoding="utf-8")

deletion_path = ROOT / "server/services/account-deletion.ts"
deletion = deletion_path.read_text(encoding="utf-8")
anchor = 'let accountDeletionProcessorTimer: NodeJS.Timeout | null = null;\n\n'
helpers = '''function getDeletionGraceWindowMs(): number {
  const configuredHours = Number(process.env.ACCOUNT_DELETION_GRACE_HOURS);
  const safeHours = Number.isFinite(configuredHours)
    ? Math.max(MIN_DELETION_GRACE_HOURS, Math.min(MAX_DELETION_GRACE_HOURS, configuredHours))
    : DEFAULT_DELETION_GRACE_HOURS;
  return Math.round(safeHours * 60 * 60 * 1000);
}

function getProcessorIntervalMs(): number {
  const configuredMs = Number(process.env.ACCOUNT_DELETION_PROCESSOR_INTERVAL_MS);
  if (!Number.isFinite(configuredMs)) return DEFAULT_PROCESSOR_INTERVAL_MS;
  return Math.max(15_000, Math.min(10 * 60_000, Math.round(configuredMs)));
}

function toMetadataObject(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function buildDeletedUsername(userId: string): string {
  return `deleted_${userId.slice(0, 8)}_${randomUUID().slice(0, 8)}`.toLowerCase();
}

'''
if 'function getDeletionGraceWindowMs()' not in deletion:
    if anchor not in deletion:
        raise SystemExit('account deletion helper anchor missing')
    deletion = deletion.replace(anchor, anchor + helpers, 1)
delete_block = '''async function deleteBetterAuthUsersForCanonicalUser(
  userId: string,
): Promise<{ deleted: boolean; count: number; error: string | null }> {'''
if delete_block not in deletion:
    raise SystemExit('Better Auth deletion helper missing')
deletion_path.write_text(deletion, encoding='utf-8')
