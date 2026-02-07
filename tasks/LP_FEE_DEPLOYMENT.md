# LP Fee Tracking Deployment Notes

## Summary
This release adds fee tracking for Liquidity Providers using a cumulative "fee growth per LP share" pattern. LPs can now see their ownership percentage and fees earned to date on both the Player page and Portfolio Liquidity tab.

## Migration Required
**CRITICAL**: Run `migrations/0021_lp_fee_growth.sql` BEFORE deploying the new code.

The migration is additive and uses `IF NOT EXISTS` so it's safe to re-run.

## Deployment Order
1. Run migration `0021_lp_fee_growth.sql` on prod database
2. Deploy new server code
3. Deploy new client code (can be simultaneous with #2)

## Historical Data Note
Existing pools and LP positions will start with feeGrowthPerLpShare = 0 and feesEarnedTotal = 0. This means:
- Fees earned BEFORE this release will not be retroactively attributed
- All fee tracking begins from deployment forward
- This is acceptable unless product requires historical attribution

## Fee Accounting Logic
- On every buy/sell trade, poolFee (1% of trade value) is added to the pool
- feeGrowthPerLpShare is incremented by poolFee / lpSharesTotal
- When an LP adds/removes liquidity, pending fees are realized

## Edge Cases Handled
- lpSharesTotal = 0: Division by zero guarded; fee growth increment skipped
- Missing columns pre-migration: Code defaults to "0" when parsing columns

## Verified Components
- server/amm/pool.ts: Fee growth updates in executeBuy, executeSell, addLiquidityOptimal, removeLiquidity
- server/routes/lp.ts: add-optimal endpoint
- client/src/pages/player.tsx: Add/Remove Liquidity modals with sliders, auto-balance toggle
- client/src/pages/portfolio.tsx: Liquidity tab shows ownership % and fees

## Testing
- npm run check - TypeScript passes
- npm run test:run - All 27 tests pass
