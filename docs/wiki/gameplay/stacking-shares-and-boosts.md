---
id: gameplay-stacking-shares-boosts
title: Stacking Shares and Boosts
summary: A full explanation of stacking shares, multipliers, boost slots, community boosts, and the exact inventory rules behind them.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/pages/boosts.tsx,server/routes.ts,server/jobs/lock-boost-shares.ts,server/jobs/settle-boosts.ts,server/jobs/settle-community-boosts.ts,server/storage.ts,shared/schema.ts
slug: stacking-shares-and-boosts
surface: web,cli,agent
searchKeywords: stack shares,stacked shares,multiplier,boosts,daily boosts,community boosts
---

# Stacking Shares and Boosts

The Boosts system is where you convert accumulated inventory into competitive payouts.

It has two parts:

1. **Stack Shares** — upgrade raw shares into high-multiplier inventory
2. **Daily Boosts** — deploy one share per slot around game windows to earn payouts

> 💡 **Think of it as refinery + deployment.** You accumulate shares through trading and scouts, refine them by stacking, then spend them strategically in boost slots.

---

## Part 1: Stack Shares

### What Stacking Does

Stack Shares converts raw player shares into a single stacked share with a higher multiplier.

**Current rules:**

- Minimum 4 raw shares to stack
- Input must be an even number
- `N` raw shares → 1 stacked share at `N/2` multiplier

**Example:**

- `10` raw shares → `1` stacked share at `5×`
- That position now contributes `5` effective shares to value and payout math
- The other `5` effective shares are burned as the cost of stacking

> ⚠️ **Stacking is a tradeoff, not a free bonus.** You give up share count to keep fewer, stronger units. Only stack when quality matters more than quantity.

### Raw vs. Stacked Shares

|                    | Raw share      | Stacked share      |
| ------------------ | -------------- | ------------------ |
| Multiplier         | 1×             | 2× or higher       |
| Tradeable          | ✅ Yes         | ❌ No              |
| Boost eligible     | ✅ Yes         | ✅ Yes (preferred) |
| Earns game payouts | Only via boost | ✅ Yes             |

### Lock Checks

Stacking only consumes **unlocked** shares. Locked shares (reserved for active boosts or other flows) cannot be stacked. Always check your available quantity before stacking.

---

## Part 2: Daily Boosts

### The Four Slot Tiers

Each day you get four boost slots:

| Slot   | Base multiplier |
| ------ | --------------- |
| Slot 1 | 5×              |
| Slot 2 | 4×              |
| Slot 3 | 3×              |
| Slot 4 | 2×              |

Each slot burns **exactly one share.** You are choosing the single most valuable share for each slot — not combining multiple shares.

### Eligibility Rules

A share is boost-eligible if:

- It's in your holdings (raw or stacked)
- It's not currently locked
- The player has a game window relevant to that day's slate
- The slot hasn't already been filled

When both raw and stacked shares exist for the same player, the system automatically prefers the **highest-multiplier** eligible share.

### The Boost Lifecycle

```
Assign → Lock (at game start) → Burn → Game plays → Settle
```

1. You assign a share to a slot before lock.
2. At game start, the share locks (no longer reassignable).
3. The share is **burned** — it leaves your inventory permanently.
4. After the game completes and stats are available, the boost settles.

> ⚠️ **The burn happens at lock, not after the result.** Boost assignment is a real, irreversible commitment.

### Payout Formula

```
payout = max(0, multiplier × fantasyPoints × effectiveMultiplier)
```

Where:

- `multiplier` = stored value of the burned share (e.g., 5 for a 5× stacked share)
- `fantasyPoints` = player's real-game fantasy output
- `effectiveMultiplier` = slot tier + number of active community boosts

The `max(0, ...)` floor ensures bad or empty fantasy output can't create a negative payout.

---

## Community Boosts

Community boosts add `+1` to the effective multiplier for any daily boost on that player and day.

**How to create one:**

- Spend one community share
- Boost is recorded for the specific player and date

**Rules:**

- Only one active community boost can exist per player per day
- Community boosts don't replace your daily boost — they make your daily boost more valuable

**Example:**

- Slot 1 (5×) + 2 active community boosts → effective multiplier = 7×

---

## Game Performance Payouts

Stacked shares (not in boost slots) can also earn payouts through a separate game-performance settlement:

- Only stacked-share multiplier positions are eligible
- Regular (raw) shares don't earn game-performance cash directly
- Payout: `earningUnits × fantasyPoints × baseRate`

This is separate from the daily boost settlement. It runs automatically for games that complete.

---

## Common Mistakes

- Burning a top stacked share without noticing a better slot target
- Stacking too aggressively, leaving too little flexible inventory for trades or LP
- Forgetting that locked shares can't be reused until the lock clears
- Treating community boosts as free value — they cost a community share each

---

## Strategic Checklist

Before assigning a boost slot, ask:

- What's the expected fantasy output for this player tonight?
- What's the multiplier of the share I'd burn?
- Is a community boost active for this player?
- Is there a better player who fits this slot?
- What's the opportunity cost of losing this share from my inventory?

---

## Next Steps

- [Scouts and Rewards](/wiki/gameplay/scouts-and-rewards) — build the inventory that feeds stacking
- [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings) — track your stacked positions
- [Sports and Slates](/wiki/gameplay/sports-and-slates) — understand game windows and lock timing
