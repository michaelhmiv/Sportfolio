# Passwordless authentication migration program

Tracking issue: #369

The migration is delivered as additive, reviewable PRs. Sportfolio's existing `users.id` remains the permanent application identity. Better Auth identities will map through an explicit `auth_identities` boundary. Production remains on Supabase until passwordless web, native, OAuth/MCP, migration, deletion and rollback paths pass certification.

## PR sequence

1. Mainline beta infrastructure and safety controls (#370)
2. ADR, Supabase exit inventory and compatibility spike (#371)
3. Better Auth schema and canonical identity boundary (#372)
4. Better Auth server foundation (#373)
5. Resend magic links and webhooks (#374)
6. Passwordless web login and dual auth (#375)
7. Native handoff (#376)
8. Identity migration and reconciliation (#377)
9. OAuth Provider and MCP authentication (#378)
10. Lifecycle, observability and certification (#379)
11. Production cutover (#380)
12. Permanent Supabase removal (#381)
