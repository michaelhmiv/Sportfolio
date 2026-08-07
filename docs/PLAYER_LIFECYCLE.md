# Player lifecycle

Sportfolio separates permanent asset identity from reversible real-world activity.

- A new player is admitted only from a current authoritative roster/feed while the athlete is active, rostered, and eligible for that sport. Historical-only, retired, and free-agent provider records are not proactively imported.
- Once admitted, the player row and canonical Sportfolio identity are permanent. Roster synchronization may set `isActive=false`, but it must never delete the player or their holdings, market, trades, price history, watchlists, scouting history, or game history.
- `isActive=true` means the athlete is currently eligible for scouting and active-sport workflows. `isActive=false` blocks new scouting and scout distributions, while the permanent asset remains directly accessible and tradeable.
- A transition to inactive atomically releases current scout assignments and closes their open scout-history intervals. Previously earned shares are untouched.
- If an athlete returns, the authoritative roster upsert reuses the same canonical player and sets `isActive=true`. Old scout assignments are not restored automatically.
- Normal marketplace browsing defaults to active athletes to avoid clutter. Explicit name search can return inactive admitted assets, and callers may request `activity=active|inactive|all`.
