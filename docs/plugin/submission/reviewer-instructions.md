# Reviewer instructions

## Product

Sportfolio is a virtual fantasy-sports portfolio game. The submitted ChatGPT/Codex app combines the shared Sportfolio public MCP capability surface with the Sportfolio Companion skill. It supports public research, connected-account reads, staged gameplay actions, explicit confirmation, cancellation, and supported immediate account writes.

## Production endpoints

- MCP: `https://www.sportfolio.market/mcp/plugin`
- OAuth protected-resource metadata: `https://www.sportfolio.market/.well-known/oauth-protected-resource`
- Plugin health: `https://www.sportfolio.market/health/plugin`
- Documentation: `https://www.sportfolio.market/plugin/`
- Support: `https://www.sportfolio.market/plugin-support/`

## Authentication

Personalized tools and all writes use Sportfolio OAuth 2.1 through Supabase Auth. Start a connected-account prompt and use the account-linking flow shown by ChatGPT. Review the Sportfolio consent screen and choose Allow access.

Provide the demo email and password only through the OpenAI submission portal's reviewer-credential fields. Do not commit credentials to this repository, include them in release notes, or place them in screenshots.

The reviewer account must:

- require no MFA;
- require no SMS or phone confirmation;
- require no email confirmation during review;
- require no VPN or private-network access;
- have no admin privileges;
- contain only synthetic review data.

## Action behavior

Market, scouting, share-stacking, boost, community-boost, and liquidity operations are staged before execution. A staged response must show the current virtual cost and account impact and return the pending thread and bundle identifiers. It is not a completed action.

After the reviewer explicitly confirms the displayed preview, the app calls `confirm_pending_action` for that exact bundle. If the reviewer declines, the app calls `cancel_pending_action`. Do not approve a different or stale bundle.

Immediate write tools, such as watchlist management, should execute only when the reviewer clearly requests the exact change and should report the completed result.

## Test order

1. Run `public-player-research` before connecting an account and confirm a public tool works.
2. Run `portfolio-overview`; complete OAuth linking when prompted.
3. Run `confirmed-market-buy`. Verify that staging does not change the portfolio, review the preview, explicitly confirm it, and verify the virtual transaction completes once.
4. Run `confirmed-daily-boost`. Review the candidate and staged preview, explicitly confirm it, and verify the boost assignment completes once.
5. Run `watchlist-management` and verify the watchlist is created and the resolved player is added.
6. Run all three negative cases and confirm credentials, real-money gambling, admin, internal, and cross-user capabilities are not invoked.
7. Open Sportfolio's Connected Applications page and disconnect the reviewer client.
8. Retry a connected-account case and confirm account linking is required again.

## Expected scope and limitations

- The app exposes the authenticated user's shared public Sportfolio MCP capabilities.
- It can perform supported virtual market and gameplay actions through Sportfolio's existing staged confirmation workflow.
- It can perform supported immediate account changes such as watchlist and schedule management when explicitly requested.
- It cannot access admin, internal, debug, raw database, mobile-store billing, unsupported provider-management, or other web-only capabilities excluded from the shared public MCP surface.
- It must not reveal or echo passwords, API keys, provider keys, OAuth tokens, MFA codes, OTPs, SMS codes, or other credentials.
- Sportfolio does not provide real-money betting, wagering, cash prizes, or cash-out.

## Troubleshooting

If a consent URL has expired, restart account linking from a new ChatGPT conversation rather than reusing the old URL. If the app reports authentication after approval, revoke the existing grant and reconnect the same reviewer account. If a staged action remains pending, retrieve the pending action and confirm or cancel the exact bundle. For support, email `sportfolioholdings@gmail.com` with the test-case ID and timestamp, but do not include passwords, provider keys, or OAuth tokens.
