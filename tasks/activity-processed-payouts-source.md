# Activity feed: processed holder payouts only

This task tracks the backend source cleanup for Activity Ledger semantics.

Requirements:
- In `server/storage.ts::getUserActivityFeed`, holder payout Activity must query only `share_payouts.status = "processed"`.
- Do not emit synthetic `share_payout_pending` rows.
- Processed holder payouts remain Activity with their credited cash delta.
- Do not remove legitimate Daily Boost entry actions merely because their current status is `locked` or `active`.
- Recalculate activity totals/category counts/summary from the actual emitted activity set as the existing method already does.
- Add a focused regression test proving pending holder payouts are absent while processed payouts remain.
- Do not change economy settlement, Daily Boost tiers, or reintroduce Stack Shares/Stack Power.
