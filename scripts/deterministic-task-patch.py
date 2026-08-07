from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "server/services/account-deletion.ts"
source = path.read_text(encoding="utf-8")
source = source.replace('import { createClient } from "@supabase/supabase-js";\n', '')
source = source.replace('  accountDeletionRequests,\n', '  accountDeletionRequests,\n  authIdentities,\n  authUsers,\n', 1)

start = source.index('const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";')
end = source.index('export async function ensureAccountDeletionSchema()', start)
replacement = '''async function deleteBetterAuthUsersForCanonicalUser(
  userId: string,
): Promise<{ deleted: boolean; count: number; error: string | null }> {
  try {
    const identities = await db
      .select({ authUserId: authIdentities.authUserId })
      .from(authIdentities)
      .where(eq(authIdentities.sportfolioUserId, userId));
    const ids = [...new Set(identities.map((identity) => identity.authUserId))];
    for (const authUserId of ids) {
      await db.delete(authUsers).where(eq(authUsers.id, authUserId));
    }
    return { deleted: true, count: ids.length, error: null };
  } catch (error) {
    return {
      deleted: false,
      count: 0,
      error: error instanceof Error ? error.message : "better_auth_delete_failed",
    };
  }
}

'''
source = source[:start] + replacement + source[end:]

old = '''  const authDeletionResults = await Promise.all(
    lockResult.authProviderSubjects.map((subject) => deleteSupabaseAuthUser(subject)),
  );
  const authDeletion = {
    deleted: authDeletionResults.every((result) => result.deleted),
    error:
      authDeletionResults
        .map((result) => result.error)
        .filter(Boolean)
        .join("; ") || undefined,
  };'''
new = '''  const authDeletionResult = await deleteBetterAuthUsersForCanonicalUser(lockResult.userId);
  const authDeletion = {
    deleted: authDeletionResult.deleted,
    error: authDeletionResult.error || undefined,
    count: authDeletionResult.count,
  };'''
if old not in source:
    raise SystemExit('provider cleanup block not found')
source = source.replace(old, new, 1)
source = source.replace(
    '        authDeletionSubjectCount: lockResult.authProviderSubjects.length,',
    '        authDeletionSubjectCount: authDeletion.count,',
    1,
)
source = source.replace('[ACCOUNT_DELETION] Processed account deletion request', '[ACCOUNT_DELETION] Processed Better Auth account deletion request')
path.write_text(source, encoding='utf-8')
