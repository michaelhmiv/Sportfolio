# Better Auth server foundation

The Better Auth server is mounted before Express body parsing so its native request handler can process authentication routes. The mount is a strict no-op while `AUTH_PROVIDER=SUPABASE`, which remains the Railway setting for both production and beta during this phase.

The server uses the namespaced Drizzle tables introduced by the authentication identity migration. It does not replace the canonical Sportfolio `users.id`; request authentication resolves into an `AuthPrincipal` whose `userId` is always the canonical application identity. The legacy `req.user.claims` shape is derived temporarily from that principal for route compatibility.

Password authentication is disabled. Magic-link delivery is also unavailable until the Resend delivery implementation and Railway secrets are configured. The production database migration remains a separate guarded operation.