# Authentication data ownership

| Data                                                           | Current owner    | Target owner                                   | Canonical application key                  |
| -------------------------------------------------------------- | ---------------- | ---------------------------------------------- | ------------------------------------------ |
| Sportfolio profile and game state                              | Railway Postgres | Railway Postgres                               | `users.id`                                 |
| Portfolios, holdings, balances, trades, scouts and collections | Railway Postgres | Railway Postgres                               | existing user foreign keys                 |
| Authentication identity and verified email                     | Supabase Auth    | Better Auth in Railway Postgres                | Better Auth ID mapped by `auth_identities` |
| Web sessions and verification records                          | Supabase Auth    | Better Auth in Railway Postgres                | Better Auth session ID                     |
| OAuth clients, grants, codes and refresh tokens                | Supabase OAuth   | Better Auth OAuth Provider in Railway Postgres | OAuth client/grant IDs                     |
| Email delivery events and suppressions                         | not centralized  | Railway Postgres via Resend webhook            | hashed recipient/event ID                  |

Railway Postgres remains authoritative for all Sportfolio application and game records. The migration must never replace existing `users.id` values with provider subjects. No password hash, Supabase access token, refresh token, or active Supabase session will be imported.
