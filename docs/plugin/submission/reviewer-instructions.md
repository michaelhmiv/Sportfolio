# Reviewer instructions

## Product

Sportfolio is a virtual fantasy-sports portfolio game. The submitted ChatGPT/Codex plugin combines a read-only MCP server with the Sportfolio Companion skill.

## Production endpoints

- MCP: `https://www.sportfolio.market/mcp/plugin`
- OAuth protected-resource metadata: `https://www.sportfolio.market/.well-known/oauth-protected-resource`
- Plugin health: `https://www.sportfolio.market/health/plugin`
- Documentation: `https://www.sportfolio.market/plugin/`
- Support: `https://www.sportfolio.market/plugin-support/`

## Authentication

Personalized tools use Sportfolio OAuth 2.1 through Supabase Auth. Start a connected-account prompt and use the account-linking flow shown by ChatGPT. Review the Sportfolio consent screen and choose Allow access.

Provide the demo email and password only through the OpenAI submission portal's reviewer-credential fields. Do not commit credentials to this repository, include them in release notes, or place them in screenshots.

The reviewer account must:

- require no MFA;
- require no SMS or phone confirmation;
- require no email confirmation during review;
- require no VPN or private-network access;
- have no admin privileges;
- contain only synthetic review data.

## Test order

1. Run `public-player-research` before connecting an account and confirm a public tool works.
2. Run `portfolio-overview`; complete OAuth linking when prompted.
3. Run `setup-review`, `collection-progress`, and `boost-candidates` while connected.
4. Run all three negative cases and confirm no write, credential, or gambling capability is invoked.
5. Open Sportfolio's Connected Applications page and disconnect the reviewer client.
6. Retry a connected-account case and confirm account linking is required again.

## Expected limitations

- Version 1 cannot execute virtual trades.
- Version 1 cannot assign boosts or scout players.
- Version 1 cannot edit watchlists, profiles, schedules, or account settings.
- Version 1 cannot reveal credentials or manage SMS/OTP authentication.
- Version 1 cannot buy or redeem premium access.
- Sportfolio does not provide real-money betting, wagering, cash prizes, or cash-out.

## Troubleshooting

If a consent URL has expired, restart account linking from a new ChatGPT conversation rather than reusing the old URL. If the plugin reports authentication after approval, revoke the existing grant and reconnect the same reviewer account. For support, email `sportfolioholdings@gmail.com` with the test-case ID and timestamp, but do not include passwords or OAuth tokens.
