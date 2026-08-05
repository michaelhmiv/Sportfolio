# Passwordless authentication identity schema

This migration is additive and safe for the intentionally shared production database.

- Existing `users.id` remains canonical.
- Better Auth records use namespaced `auth_*` tables.
- `auth_identities` maps Better Auth users to Sportfolio users.
- Tombstones are checked before linking or provisioning.
- Better Auth remains runtime-disabled after merge.
- Beta may not execute this migration.
- Production execution requires the guarded migration workflow, exact confirmation values, and a verified backup.
- Do not use `drizzle-kit push` against the shared production database for this migration.
