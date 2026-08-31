from pathlib import Path

path = Path("server/storage.ts")
source = path.read_text()
old = '''            .where(and(eq(sharePayouts.userId, userId), ne(sharePayouts.status, "cancelled")))
            .orderBy(desc(sharePayouts.createdAt))
            .limit(fetchWindow);

          return payouts.map((payout) => {
            const payoutAmount = toHoldingNumber(payout.payoutAmount);
            const fantasyPoints = toHoldingNumber(payout.fantasyPoints);
            const playerName = `${payout.playerFirstName} ${payout.playerLastName}`.trim();
            const isProcessed = payout.status === "processed";

            return {
              id: `holder-payout-${payout.id}`,
              timestamp: toActivityTimestamp(payout.processedAt || payout.occurredAt),
              category: "payouts",
              type: isProcessed ? "share_payout_processed" : "share_payout_pending",
              title: isProcessed ? "Holder payout credited" : "Holder payout pending",
              description: `${isProcessed ? "Credited" : "Queued"} holder payout for ${playerName}`,
              cashDelta: isProcessed && payoutAmount > 0 ? payoutAmount.toFixed(2) : undefined,
              status: payout.status,
'''
new = '''            .where(and(eq(sharePayouts.userId, userId), eq(sharePayouts.status, "processed")))
            .orderBy(desc(sharePayouts.createdAt))
            .limit(fetchWindow);

          return payouts.map((payout) => {
            const payoutAmount = toHoldingNumber(payout.payoutAmount);
            const fantasyPoints = toHoldingNumber(payout.fantasyPoints);
            const playerName = `${payout.playerFirstName} ${payout.playerLastName}`.trim();

            return {
              id: `holder-payout-${payout.id}`,
              timestamp: toActivityTimestamp(payout.processedAt || payout.occurredAt),
              category: "payouts",
              type: "share_payout_processed",
              title: "Holder payout credited",
              description: `Credited holder payout for ${playerName}`,
              cashDelta: payoutAmount > 0 ? payoutAmount.toFixed(2) : undefined,
              status: payout.status,
'''
count = source.count(old)
if count != 1:
    raise SystemExit(f"Expected exactly one payout Activity block; found {count}")
path.write_text(source.replace(old, new, 1))
