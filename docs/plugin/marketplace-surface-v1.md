# Marketplace Surface v1

## Public tools

These tools do not require a connected Sportfolio account:

| Tool                      | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `search_sportfolio_docs`  | Search published Sportfolio documentation.                     |
| `get_sportfolio_doc`      | Read one published Sportfolio documentation article.           |
| `search_players`          | Find active players by name, team, position, or sport.         |
| `get_player_overview`     | Read a sanitized player and virtual-market overview.           |
| `get_player_recent_games` | Read recent sanitized game logs for one player.                |
| `get_games`               | Read the Sportfolio game slate for a requested date and sport. |

## Connected-account tools

These tools require OAuth authorization for the connected Sportfolio account:

| Tool                          | Purpose                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `get_my_dashboard`            | Read a composed balance, portfolio, boosts, scouts, and watchlist summary. |
| `get_my_portfolio`            | Read sanitized virtual positions and concentration details.                |
| `get_my_portfolio_history`    | Read sanitized virtual portfolio history.                                  |
| `get_my_balance`              | Read the user's virtual Sportfolio balance.                                |
| `get_my_watchlists`           | List the user's watchlists.                                                |
| `get_my_watchlist`            | Read one watchlist and its players.                                        |
| `get_my_daily_boosts`         | Read current daily boost state.                                            |
| `get_my_boost_history`        | Read recent boost history and virtual outcomes.                            |
| `get_my_collections`          | List collection progress.                                                  |
| `get_my_collection`           | Read one collection and matching owned players.                            |
| `get_my_milestones`           | Read milestone history.                                                    |
| `get_my_game_insights`        | Join the game slate with relevant owned players and boosts.                |
| `find_my_boost_candidates`    | Produce read-only daily boost candidate analysis.                          |
| `find_my_scout_opportunities` | Produce read-only scout allocation opportunities.                          |

ChatGPT is responsible for general sports research, news synthesis, user-created scheduled summaries, and narrative setup reviews. Sportfolio exposes only the approved gameplay and account capabilities listed here.

## Excluded capabilities

The following capability groups are excluded from marketplace v1:

- trades and market mutations;
- liquidity-provider mutations;
- daily or community boost assignment/removal;
- scout assignment changes;
- pending-action confirmation and cancellation;
- API-token creation, listing, and revocation;
- BYOK credential management;
- account/profile mutations;
- schedules and recurring jobs;
- premium redemption, checkout, funding, billing, and purchases;
- admin and internal routes;
- hosted open-web research and generated news digests;
- raw provider data and dynamically imported MLB MCP tools.

## Output policy

All tools return dedicated DTOs with explicit output schemas. Results must be bounded and must not contain unrestricted nested application records.

Forbidden output fields include credentials, authorization headers, cookies, access/refresh tokens, one-time codes, phone numbers, account email unless specifically approved, internal user identifiers, service keys, provider keys, SQL, stack traces, request/session identifiers, or raw ORM records.

## Failure behavior

- Missing account authorization returns an MCP OAuth challenge rather than a generic application error.
- Missing data returns a successful empty-state result when appropriate.
- Invalid user inputs return a stable `invalid_arguments` error.
- Upstream sports-data degradation returns partial data with an explicit warning when possible.
- Internal exceptions return a stable error code without stack traces or implementation details.
