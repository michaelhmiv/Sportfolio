# NFL preseason box-score repair

Implement the approved NFL display/gameplay separation on top of the permanent-player lifecycle release.

Required behavior:
- ESPN current/live remains the provider; five-minute job cadence unchanged.
- Persist a generic game-level box score so ESPN stat lines can display even when they do not resolve to a Sportfolio player.
- Box-score/stat ingestion MUST NOT create a new Sportfolio player. New asset admission remains the authoritative active-roster path.
- Existing admitted players resolve through GSIS/ESPN aliases and receive player_game_stats.
- ESPN parser must tolerate missing athlete.position in box-score rows and retain QB/RB/WR/TE/K-relevant passing/rushing/receiving/fumble/kicking categories.
- Preseason stats display normally but gameplayEligible=false and player_game_stats.fantasyPoints must not allocate fantasy value.
- Add an idempotent date-range backfill command and use it after production deployment for the Aug. 6, 2026 Hall of Fame Game (ESPN event 401873271, CAR 33-30 ARI).
- Fix the existing NFL game-stats modal so passing/rushing/receiving/kicking stats render correctly and unresolved display-only athletes are not clickable as Sportfolio assets.
- Do not change NFL positions, scoring rules for eligible games, polling cadence, market seeding, or historical nflverse reconciliation.

Run typecheck, lint/format, full Vitest, public-tool audit, production build and trusted-workflow checks.