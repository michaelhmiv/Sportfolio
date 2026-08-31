# NASCAR performance context and weekend analytics

## Goal

Add a clean, additive NASCAR analytics layer to Sportfolio that helps users decide who to buy, scout, and boost without changing any existing fantasy scoring, RAX earnings, boost settlement, payout, market, or race-state semantics.

This task is specifically about surfacing underlying car/driver performance and pre-race weekend pace using NASCAR public data that Sportfolio already consumes or can reliably consume from the same official/public feed surfaces.

## Non-negotiable safety / compatibility constraints

1. DO NOT change `calculateFantasyPoints`, live fantasy-point formulas, RAX payout formulas, boost settlement, share payouts, player pricing, AMM logic, or any economy logic.
2. Practice and qualifying MUST remain non-race sessions. They must never mark a race in progress/completed, write race fantasy points, settle boosts, or otherwise masquerade as the race.
3. Preserve current Cup/Xfinity/Truck behavior and stable NASCAR player IDs.
4. New provider fields must be optional and null-safe. Missing NASCAR fields must never break live sync, final sync, race insights, player pages, or command center rendering.
5. Do not add scraping or depend on premium/private SMT telemetry. Use the current NASCAR public feed/weekend feed or other public NASCAR feed endpoints only when reliable.
6. Prefer additive JSON/context fields and API response enrichment over invasive schema changes. Do not add a database migration unless there is a compelling repository-consistent reason.
7. No new third-party dependencies unless absolutely necessary.
8. Keep mobile/responsive UI clean. Do not turn the NASCAR live table into an unreadable wall of columns.

## Existing architecture to preserve

- `server/nascar-api.ts` already supports live feed, race schedule, weekend feed, enhanced final results, practice/qualifying driver discovery, and fantasy-point calculation.
- `server/jobs/sync-nascar-live.ts` intentionally ignores non-race run types and writes rich live `statsJson` fields such as running/start position, laps, average running position/speed, best lap data, gap, DVP status, stage, cautions, lead changes, etc.
- `server/jobs/sync-nascar-stats.ts` writes authoritative final race results and fantasy points.
- `server/routes.ts` has NASCAR race snapshot/insight logic.
- `client/src/components/game-command-center-modal.tsx` already has a NASCAR-specific live table.
- `client/src/components/player-modal.tsx` already has NASCAR-specific season/recent-race presentation.

Important current edge: rich live `statsJson` can be replaced by a smaller final-results `statsJson`. Fix this so useful analytics survive finalization, without allowing stale live fields to override authoritative final race fields.

## Features to implement

### P0 — Weekend pace (practice + qualifying)

Use the existing `fetchWeekendFeed()` path rather than treating practice/qualifying as live race stats.

Expose a compact weekend context for the relevant race/driver where data exists:
- latest/relevant practice session rank
- best practice lap speed
- best practice lap time when useful
- qualifying position/rank
- qualifying best lap speed
- qualifying best lap time when useful
- starting position when known
- session names so multi-round/group qualifying does not get mislabeled

If there are multiple practice or qualifying runs, choose a sensible summary while retaining enough structured data for the UI to label it correctly. Prefer the latest completed qualifying result as the displayed qualifying result. Do not invent data when NASCAR omits a field.

Surface weekend pace cleanly in a NASCAR pre-race context (race Command Center and/or player NASCAR context) where it can influence buy/scout/boost decisions before race start.

### P0 — Average running position

Average running position is already ingested live. Promote it to a first-class NASCAR performance metric.

- Preserve it through finalization when a valid live value exists.
- Show it in the live/post-race NASCAR experience without making the table excessively wide.
- Include it in recent-race/player context where practical.

### P0 — Result Delta

Add a derived metric that compares actual/current position to average running position.

Use this sign convention consistently:
- `resultDelta = averageRunningPosition - resultPosition`
- positive = result is better than average running position
- negative = result is worse than average running position

Examples:
- avg run 18.6, finish 6 => +12.6
- avg run 5.8, finish 27 => -21.2

Name it `resultDelta` in data. In UI, label clearly (for example `Result Δ`) and do not call it "luck".

### P0 — Fast-lap rate

Add a normalized pace metric:
- `fastLapPct = fastestLaps / eligibleLaps * 100`

Use the best sensible denominator available from current data (normally laps completed; if the provider exposes a more defensible green-flag-lap denominator, document/use that). Guard division by zero. Keep raw fastest-lap count unchanged for scoring.

### P0/P1 — Public loop/performance fields when available

Inspect the actual NASCAR public live/weekend/result payloads and existing repository integration before choosing field names. Safely ingest and expose these when the current public feed provides them:
- green-flag passes / passes made
- times passed
- passing differential
- quality passes
- laps in top 15
- top-15 percentage
- driver rating
- average restart speed
- closing/final-10%-position differential if present

Do not assume a field exists. Support provider naming variants only when evidence in the actual payload/API warrants it. Nullable values are expected.

If a metric such as Driver Rating or Top-15 laps is not available from the current feed surface without introducing a brittle new integration, leave it null/omitted rather than fabricating it. Structure the code so it can be populated later.

### P1 — Passing differential

Where pass data is available, provide:
- passesMade
- timesPassed
- passingDifferential
- qualityPasses

If `passingDifferential` is absent but both passesMade and timesPassed are present, derive it as passesMade - timesPassed.

Compact UI should favor `Pass Δ` rather than showing four permanent columns. Additional details can be in a secondary/expanded view.

### P1 — Top-15 rate

Where NASCAR provides top-15 laps:
- preserve raw `top15Laps`
- derive `top15Pct = top15Laps / eligibleLaps * 100`
- guard missing/zero denominators

### P1 — Driver Rating

If reliably available from a public NASCAR feed endpoint/payload already compatible with the integration, store and show it as an analytics metric only. It must not affect Sportfolio fantasy scoring.

### P1 — Track / track-type context

Add useful historical context only if it can be done reliably with data already in the repository/public NASCAR feeds without a large unrelated rewrite.

Preferred order:
1. same-track recent performance
2. track-type performance if track type metadata is reliable

Useful aggregated metrics include average finish, average running position, fantasy points, fastest-lap rate, top-15 rate, and Driver Rating when available.

This should be scouting/context only, not pricing/scoring logic.

## Data-model / persistence guidance

Keep authoritative scoring fields and analytics conceptually separate even if both live inside `statsJson` for compatibility.

A sensible shape is:

```ts
statsJson: {
  // existing canonical/scoring fields remain flat for compatibility
  finishPosition,
  startPosition,
  lapsLed,
  fastestLaps,
  ...,

  performance: {
    averageRunningPosition,
    averageSpeed,
    resultDelta,
    fastLapPct,
    passesMade,
    timesPassed,
    passingDifferential,
    qualityPasses,
    top15Laps,
    top15Pct,
    driverRating,
    averageRestartSpeed,
  }
}
```

Do not break existing readers of the current flat fields. It is fine to preserve compatible flat aliases while adding a nested `performance` object.

When final stats are written, merge/preserve valid analytics context from the existing live record, but authoritative final fields (finish, start, final laps completed, final laps led, fastest laps, fantasy points, provider points, final status) must come from the final result path.

Do not let stale live `runningPosition`, live flag state, or live laps-to-go cause a completed race to appear live after final sync.

## UI requirements

### NASCAR live/post-race Command Center

Keep the existing sticky Driver / FP / $ behavior.

Improve the NASCAR performance presentation without making the table materially wider on mobile. Good options include:
- add `Avg` and `Pass Δ` while removing/relegating less decision-useful permanent columns, OR
- add a compact Performance subline/expandable detail per driver, OR
- a responsive desktop/mobile split.

At minimum, users should be able to see:
- current/final position
- start
- position differential
- average running position
- laps led
- fastest laps or fast-lap %
- Result Δ
- Pass Δ when available

Keep Best MPH/gap/car/status available where useful, but do not prioritize them above the core performance metrics on narrow screens.

### NASCAR pre-race

Show a compact `Weekend Pace` section/card when practice/qualifying data exists, e.g.:

- Practice P4 · 176.8 mph
- Qualifying P7 · 178.1 mph
- Start P7

Handle missing sessions gracefully (rainouts, standalone series events, no practice, etc.).

### NASCAR player modal/detail

Enhance NASCAR-specific performance context cleanly. Preferred summary metrics:
- Avg Run
- Result Δ (rolling/recent if available)
- Fast Lap %
- Pass Δ when available
- Top-15 % when available
- Driver Rating when available

Do not remove the existing FP/G, wins, top 5, top 10, laps led, fastest laps, races, win-rate information unless there is a strong UX reason; use grouping/secondary context rather than crowding.

## Regression tests / acceptance criteria

Add targeted tests proving the analytics are additive.

Required tests:

1. Existing `calculateFantasyPoints()` output for representative race-result fixtures is unchanged.
2. Live NASCAR fantasy-point calculation remains unchanged for representative live fixtures after analytics fields are added.
3. Practice/qualifying live feeds still do NOT write race stats or mark the race completed/in-progress incorrectly.
4. Final race sync preserves valid analytics context from an existing live record while overwriting authoritative final race fields.
5. A stale live terminal/race-state field cannot make finalized stats appear live after final sync.
6. `resultDelta`, `fastLapPct`, passing differential derivation, and top15Pct calculations handle normal and missing/zero data correctly.
7. Missing optional provider analytics fields do not fail sync or rendering.
8. Existing NASCAR race insight API shape remains backwards-compatible; new fields are additive.
9. UI handles null analytics values without `NaN`, `undefined`, layout breakage, or placeholder noise.
10. Existing NASCAR tests continue passing.

Run the relevant unit/test/typecheck/lint commands available in the repository. Fix failures caused by this task. Do not make unrelated cleanup changes.

## Scope discipline

Focus only on NASCAR analytics/weekend context and the persistence/UI changes necessary to expose it safely.

Do NOT:
- change Sportfolio economy/scoring
- redesign all sports
- rewrite generic game infrastructure
- add telemetry scraping
- add speculative metrics unsupported by provider data
- perform unrelated refactors

## Deliverable

A production-ready implementation on this PR branch, with concise code comments around the race-vs-weekend separation and final-result analytics merge, plus tests demonstrating scoring/economy behavior remains unchanged.
