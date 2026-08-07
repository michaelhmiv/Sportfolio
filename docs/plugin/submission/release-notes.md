# Release notes — Sportfolio Companion 2.0.0

This is the initial public submission of the full Sportfolio Companion experience.

The app combines Sportfolio's shared public MCP capability registry with a Sportfolio-specific skill. It provides public documentation, player, and game research and lets users connect a Sportfolio account through OAuth 2.1 to review and manage supported virtual portfolio and gameplay workflows.

Version 2 includes the existing Sportfolio staged-action system for virtual market buys and sells, scouting, share stacking, daily boosts, community boosts, and liquidity operations. These workflows produce a current preview and pending bundle, require explicit user confirmation, and execute only through `confirm_pending_action`; users may cancel with `cancel_pending_action`.

The app also includes supported authenticated watchlist, schedule, profile, onboarding, milestone, news, premium, and account controls from the shared site MCP surface. Private-data and write tools are OAuth-only, every tool declares explicit safety annotations and an output schema, and all responses pass through marketplace sanitization.

Admin, internal, debug, raw database, mobile-store billing, unsupported provider-management, and other web-only capabilities excluded from the shared public MCP contract remain unavailable.

Reviewer credentials are supplied separately in the submission portal. The reviewer account contains synthetic fixture data and does not require MFA, SMS, email confirmation, VPN access, or private-network access during review.

Sportfolio shares, balances, values, trades, gains, losses, and payouts are virtual gameplay units with no cash value. Sportfolio does not provide real-money betting, wagering, cash prizes, or cash-out functionality.
