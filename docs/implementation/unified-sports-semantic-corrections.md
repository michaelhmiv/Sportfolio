# Unified sports semantic correction ledger

Issue #346 corrects semantic drift without changing market prices, payouts, scouting, boosts, liquidity, or trade behavior.

| Path                         | Before                     | After                                                                             | Compatibility                                                        |
| ---------------------------- | -------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| MLB suspended                | `postponed`                | `suspended`                                                                       | Existing status remains a string; new enum value is additive.        |
| MLB delayed                  | Always `postponed`         | `scheduled` or `in_progress` when provider phase supports it; otherwise `unknown` | Source status, confidence, and reason are included.                  |
| MLB linescore without inning | `scheduled`                | `unknown`                                                                         | Prevents false scheduling claims; phase is nullable.                 |
| NHL suspended                | `postponed`                | `suspended`                                                                       | Additive status value.                                               |
| NHL unknown provider state   | `scheduled`                | `unknown`                                                                         | No silent coercion.                                                  |
| NASCAR schedule completion   | Silent inference           | Same compatible status plus `statusSource=inferred`, confidence, and reason       | Existing status preserved.                                           |
| NASCAR live phase            | String-only period         | Adds structured stage and lap progress                                            | Existing `period`, `clock`, and `summary` remain.                    |
| Duplicate events             | Provider order/duplicates  | Deterministic reconciliation by canonical ID, freshness, status rank, then time   | Existing event shape preserved; conflict count is additive metadata. |
| Freshness                    | Hard-coded `isStale=false` | Computed from source watermark/fetch time and TTL                                 | Existing provider fields preserved.                                  |

Metrics are process-local counters for unknown status, fallback, duplicate event, event conflict, and identity conflict paths. The production audit command is read-only and checks `daily_games` for duplicate IDs, invalid statuses, and invalid timestamps.

Affected consumers are unified public sports tools and `get_sports_context`. Existing app/gameplay storage contracts are unchanged. Rollback is a single PR revert; additive fields can be ignored by older clients.
