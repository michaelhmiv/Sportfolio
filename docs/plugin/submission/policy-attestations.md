# Policy attestation worksheet

Complete the portal attestations only after every statement below has been independently confirmed against the deployed release.

## Publisher and listing

- [ ] The selected developer or business identity is verified in the same OpenAI organization used for submission.
- [ ] The submitter has Apps Management write access.
- [ ] Sportfolio's publisher name, website, support contact, privacy policy, terms, and logo are accurate and consistent.
- [ ] Listing copy describes only capabilities available in the submitted full-action release.

## MCP and authentication

- [ ] The MCP URL is public, production, HTTPS, and points to `/mcp/plugin`.
- [ ] Domain verification returns the exact OpenAI challenge token.
- [ ] OAuth discovery, dynamic registration or approved client registration, PKCE, refresh, revocation, resource audience, and JWKS validation work.
- [ ] Every private-data or write tool is OAuth-only.
- [ ] Reviewer credentials work without MFA, SMS, email confirmation, VPN, or private-network access.
- [ ] The reviewer account is synthetic and non-admin.

## Tools and actions

- [ ] The scanned static catalog exactly matches Sportfolio's shared public site MCP registry.
- [ ] Dynamically discovered MLB tools are included only when the bounded source is healthy and their scanned definitions have been reviewed.
- [ ] Every tool's name, description, input schema, output schema, security scheme, and annotations match deployed behavior.
- [ ] Every tool explicitly declares `readOnlyHint`, `openWorldHint`, and `destructiveHint`.
- [ ] Public unauthenticated tools are read-only documentation, player, or schedule research tools.
- [ ] Staged market, scouting, stacking, boost, community-boost, and liquidity actions return a preview and pending bundle before execution.
- [ ] `confirm_pending_action` executes only the exact reviewed bundle and is treated as a destructive finalizer.
- [ ] `cancel_pending_action` abandons a pending bundle without applying the gameplay action.
- [ ] Immediate write tools are invoked only for a user's clear request for that exact account change.
- [ ] Admin, internal, debug, raw database, mobile-store billing, unsupported provider-management, and web-only controls remain excluded.

## Sensitive account workflows and data

- [ ] Credential, token, and BYOK management tools have received explicit manual review before submission.
- [ ] The skill never asks users to paste passwords, API keys, provider keys, access tokens, refresh tokens, MFA codes, OTPs, or SMS codes into conversation.
- [ ] Tool responses are sanitized and contain no passwords, provider keys, authentication tokens, authorization headers, cookies, service-role data, direct contact fields, stack traces, SQL, session IDs, request IDs, or undisclosed internal fields.
- [ ] Any pending thread and bundle identifiers returned are limited to continuing the user's approved staged workflow.

## Product and policy

- [ ] Sportfolio is accurately described as a virtual fantasy-sports portfolio game.
- [ ] The app does not offer real-money investment, wagering, betting, cash prizes, or cash-out.
- [ ] Virtual shares, balances, values, trades, gains, losses, and payouts are clearly disclosed as having no cash value.
- [ ] Privacy, terms, documentation, and support pages accurately match production read and write behavior.
- [ ] Legal review has been completed for public policy text and initial country availability.

## Testing and release

- [ ] The final Plugin Readiness workflow passes on the release commit.
- [ ] Five positive and three negative cases pass in fresh ChatGPT conversations.
- [ ] Positive tests cover public research, authenticated portfolio reads, a staged and confirmed market trade, a staged and confirmed boost, and an immediate watchlist workflow.
- [ ] The final skill tree has been tested locally.
- [ ] The latest MCP scan and skill snapshot match the release commit.
- [ ] `.app.json` contains the assigned Sportfolio `plugin_asdk_app...` ID, not the placeholder.
- [ ] Release notes and reviewer instructions match the deployed fixture account.
