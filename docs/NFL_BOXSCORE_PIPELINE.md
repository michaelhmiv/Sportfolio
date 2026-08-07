# NFL box-score pipeline

- ESPN scoreboard/summary is fetched only by scheduled/operational ingestion, never by the public game-stats route.
- The normalized game-level box score is persisted in `game_boxscores` so provider athletes can display without being Sportfolio assets.
- A box-score row only projects into `player_game_stats` when it resolves to an already-admitted NFL player. Statistics ingestion does not create assets.
- Preseason rows use `gameplayEligible=false` and persist `fantasyPoints=0.00`; raw football statistics remain visible.
- Completed games are reconciled at the game-box-score level. `npm run nfl:backfill-boxscores -- --from=YYYY-MM-DD --to=YYYY-MM-DD` force-refreshes a bounded date range idempotently.
- Live polling cadence remains five minutes.
