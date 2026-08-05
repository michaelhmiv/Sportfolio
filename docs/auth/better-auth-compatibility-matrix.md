# Better Auth compatibility matrix

This matrix records package/API compatibility established without connecting to Railway or exposing Better Auth routes.

| Requirement | Status | Evidence or later gate |
| --- | --- | --- |
| Matching stable Better Auth package versions | PASS | exact package pins and lockfile |
| Zod 4 and drizzle-zod compatibility | PASS | exact pins; repository typecheck and full suite |
| Express/Node handler construction | PASS | `scripts/better-auth-compatibility.test.ts` |
| Password registration rejected while disabled | PASS | disabled configuration plus non-success route test |
| Magic-link five-minute expiry | PASS | typed plugin configuration |
| Hashed verification-token storage | PASS | `storeToken: "hashed"` configuration |
| Atomic first-attempt token consumption | DOCUMENTED | upstream magic-link contract; database concurrency proof is PR 4 |
| Automatic signup after verified link | DOCUMENTED | plugin default; provisioning idempotency is PR 5 |
| OAuth Provider plugin construction | PASS | typed compatibility harness |
| PKCE S256 for public clients | DOCUMENTED | OAuth Provider default; protocol conformance is PR 8 |
| Dynamic unauthenticated public-client registration | PASS | typed provider option |
| Consent approval and denial | DEFERRED | PR 8 integration tests |
| Authorization continuation across login | DEFERRED | PRs 5 and 8 |
| `offline_access` and refresh rotation | DEFERRED | PR 8 protocol tests |
| Revocation and disabled clients | DEFERRED | PR 8 protocol tests |
| JWKS signing and validation | PASS | JWT plugin compiles with OAuth Provider; cryptographic conformance is PR 8 |
| OAuth `resource` to JWT `aud` | DEFERRED | PR 8 token exchange tests |
| Subject mapping to canonical `users.id` | PASS | ADR boundary; schema enforcement is PR 2 |
| Existing `req.pluginAuth` contract | DEFERRED | PR 8 MCP integration tests |
| Live ChatGPT connection | DEFERRED | beta certification after PR 8 |

No row marked DEFERRED is claimed as live compatibility proof. Those rows are explicit merge gates for their implementation PRs.
