# Authentication data ownership

| Data                                                           | Current owner                                  | Canonical application key                  |
| -------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| Sportfolio profile and game state                              | Railway Postgres                               | `users.id`                                 |
| Portfolios, holdings, balances, trades, scouts and collections | Railway Postgres                               | existing user foreign keys                 |
| Authentication identity and verified email                     | Better Auth in Railway Postgres                | Better Auth ID mapped by `auth_identities` |
| Web sessions and verification records                          | Better Auth in Railway Postgres                | Better Auth session ID                     |
| OAuth clients, grants, codes and refresh tokens                | Better Auth OAuth Provider in Railway Postgres | OAuth client/grant IDs                     |
| Email delivery events and suppressions                         | Railway Postgres via Resend webhook            | hashed recipient/event ID                  |

Railway Postgres is authoritative for all Sportfolio application, game, authentication, and OAuth records. The migration must never replace existing `users.id` values with provider subjects. Password hashes, provider access tokens, refresh tokens, and legacy provider sessions are not imported into the active runtime.
