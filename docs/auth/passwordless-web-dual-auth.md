# Passwordless web login and dual-auth transition

Web authentication uses one email field and an opaque, single-use continuation. Better Auth cookie sessions resolve before temporary Supabase bearer fallback, so a Supabase token cannot override an established Better Auth session. Existing and new Better Auth identities map to the canonical Sportfolio `users.id` through `auth_identities`.

The implementation remains dormant while Railway uses `AUTH_PROVIDER=SUPABASE`. To test it, the production database migration must first be applied through the guarded production workflow, then beta may use `AUTH_PROVIDER=DUAL` with magic links enabled and Supabase fallback retained.

Completion states distinguish missing, invalid, expired, and consumed links without disclosing whether an email address already existed. Logout revokes the Better Auth server session, signs out the temporary Supabase session when present, clears user-scoped queries, and broadcasts the state change to other tabs.

Because the canonical auth endpoint and application use sibling subdomains, `BETTER_AUTH_COOKIE_DOMAIN=.sportfolio.market` is required during activation. Better Auth then shares only its signed HttpOnly session cookies across the approved Sportfolio subdomains; trusted-origin and CSRF validation remain enabled.
