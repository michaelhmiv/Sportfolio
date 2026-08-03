# Tool selection reference

## Public information

| User intent | Tool sequence |
| --- | --- |
| Explain a rule or feature | `search_sportfolio_docs`, then `get_sportfolio_doc` when needed |
| Find a player | `search_players` |
| Review one player broadly | `search_players` if ambiguous, then `get_player_overview` |
| Review recent player games | `search_players` if ambiguous, then `get_player_recent_games` |
| Review a sport schedule | `get_games` |

## Connected account

| User intent | Tool sequence |
| --- | --- |
| Broad account review | `get_my_dashboard` |
| Current holdings | `get_my_portfolio` |
| Virtual performance history | `get_my_portfolio_history` |
| Virtual balance/capacity | `get_my_balance` |
| List watchlists | `get_my_watchlists` |
| Inspect one watchlist | `get_my_watchlists`, then `get_my_watchlist` |
| Current boosts | `get_my_daily_boosts` |
| Boost outcomes | `get_my_boost_history` |
| Candidate boost ideas | `find_my_boost_candidates` |
| Collection overview | `get_my_collections` |
| One collection | `get_my_collections`, then `get_my_collection` |
| Milestone progress | `get_my_milestones` |
| Personalized game impact | `get_my_game_insights` |
| Daily digest | `get_my_news_digest` |
| Broad setup analysis | `review_my_sportfolio_setup` |
| Scout ideas | `find_my_scout_opportunities` |

Do not use a broad dashboard call when a narrower tool fully answers the request. Do not call public and connected variants redundantly unless the user asks for both general and personalized context.
