# Policy attestation worksheet

Complete the portal attestations only after every statement below has been independently confirmed against the deployed release.

## Publisher and listing

- [ ] The selected developer or business identity is verified in the same OpenAI organization used for submission.
- [ ] The submitter has Apps Management write access.
- [ ] Sportfolio's publisher name, website, support contact, privacy policy, terms, and logo are accurate and consistent.
- [ ] Listing copy describes only capabilities available in version 1.

## MCP and authentication

- [ ] The MCP URL is public, production, HTTPS, and points to `/mcp/plugin`.
- [ ] Domain verification returns the exact OpenAI challenge token.
- [ ] OAuth discovery, dynamic registration or approved client registration, PKCE, refresh, revocation, resource audience, and JWKS validation work.
- [ ] Reviewer credentials work without MFA, SMS, email confirmation, VPN, or private-network access.
- [ ] The reviewer account is synthetic and non-admin.

## Tools and data

- [ ] The scanned tool catalog contains exactly the reviewed 22 tools.
- [ ] Every tool's name, description, input schema, output schema, security scheme, and annotations match deployed behavior.
- [ ] Every v1 tool is read-only, non-destructive, and closed-world.
- [ ] No API-key, password, OAuth-token, SMS/OTP, billing, premium, account-write, trade, liquidity, or dynamic sidecar tool is exposed.
- [ ] Tool responses contain no unnecessary personal data, authentication secrets, debug payloads, stack traces, SQL, raw internal identifiers, or undisclosed user fields.

## Product and policy

- [ ] Sportfolio is accurately described as a virtual fantasy-sports portfolio game.
- [ ] The plugin does not offer real-money investment, wagering, betting, cash prizes, or cash-out.
- [ ] Virtual shares, balances, values, gains, losses, and payouts are clearly disclosed as having no cash value.
- [ ] Privacy, terms, and support pages accurately match production behavior and telemetry.
- [ ] Legal review has been completed for public policy text and initial country availability.

## Testing and release

- [ ] The final Plugin Readiness workflow passes on the release commit.
- [ ] Five positive and three negative cases pass in fresh ChatGPT conversations.
- [ ] The final skill tree has been tested locally.
- [ ] The latest MCP scan and skill snapshot match the release commit.
- [ ] `.app.json` contains the assigned Sportfolio `plugin_asdk_app...` ID, not the placeholder.
- [ ] Release notes and reviewer instructions match the deployed fixture account.
