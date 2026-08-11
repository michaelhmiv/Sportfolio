# Sportfolio Economy V2

This directory owns the canonical monetary rules for player earnings and direct-share Boosts.

- Regular-season benchmark earnings target: 10,000 SB.
- Postseason benchmark earnings target: 10,000 SB as a separate earning season.
- Sport/position differences are normalized by versioned historical full-season fantasy-point benchmarks.
- Base player/game SB is capped by performance; outstanding Singles divide that pool through EPS and never increase it.
- Daily Boosts use Singles directly at 2x, 3x, 5x, 7x, and 10x.
- Boosted Singles receive their ordinary 1x base EPS from the pre-burn record snapshot; Boost settlement mints only the incremental `(multiplier - 1)` bonus.
- Boosted Singles are permanently burned once a valid game begins.
- Stack Power is retired and must not be reintroduced into active runtime or public surfaces.

Future economy changes should adjust the centralized targets/benchmark calibration rather than adding hidden payout coefficients.