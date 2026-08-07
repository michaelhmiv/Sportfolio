---
id: gameplay-scouts-rewards
title: Scouts and Share Rewards
summary: How scouts work, how hourly share distribution is calculated, and how to use them as a steady accumulation engine.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/components/scout-widget.tsx,client/src/components/scout-dashboard-modal.tsx,server/routes.ts,server/jobs/scout-distribution.ts,shared/schema.ts
slug: scouts-and-rewards
surface: web,cli
searchKeywords: scouts,share rewards,free shares,scout minutes,hourly distribution
---

# Scouts and Share Rewards

Scouts are your passive share-accumulation engine. Assign a scout to a player and it earns shares for you over time — no active trading required.

> 💡 **Scouts mint player-share inventory, not cash.** Those shares feed your future trades, boost slots, and stacking pipeline.

---

## Scout Capacity

| Account type | Max scouts |
| ------------ | ---------- |
| Standard     | 5          |
| Premium      | 10         |

Premium doubles your accumulation bandwidth. The underlying distribution math stays the same regardless of tier.

---

## How Rewards Are Calculated

Scout distributions run **every hour.**

The key concept is **scout-minutes** — the time you've had a scout assigned to a player during that hour. The more of the hour your scouts spent on a player, the larger your share of the hourly reward.

**Formula:**

```
sharesEarned = floor((60 × userScoutMinutes / globalScoutMinutes) × 100) / 100
```

In plain English:

- Your reward = your scout-minutes ÷ all scout-minutes on that player × 100 shares distributed
- Results are rounded down to two decimal places

**Example:**

- 1,000 global scout-minutes on Player A this hour
- Your scout was on Player A for 45 minutes → 45 scout-minutes
- Your share: `floor((60 × 45 / 1000) × 100) / 100 = 2.7 shares`

---

## Why Timing Matters

Scout history is recorded continuously. Switching scouts late in an hour has real consequences:

- You lose scout-minutes you already built up on the old player
- You start from zero on the new player for that hour
- Last-minute moves can materially reduce your reward

> ⚠️ **Move scouts when your conviction changes — not impulsively.** The distribution is time-weighted, so persistence pays off.

---

## Inactivity Cleanup

Scout assignments aren't permanent if an account goes idle.

The system automatically clears active scout assignments for accounts **inactive for more than 24 hours.** This prevents abandoned accounts from farming shares indefinitely.

---

## What a Strong Scout Setup Looks Like

**Do:**

- Focus scouts on a small number of conviction names (3–5 is usually better than spreading all 5 or 10)
- Revisit assignments when news changes your outlook on a player
- Align scouts with players you actually want more inventory of
- Treat scouts as inventory builders, not lottery tickets

**Don't:**

- Spread scouts across too many players — small rewards in too many places add up to nothing useful
- Forget the hourly cadence — last-minute changes affect your results
- Leave scouts idle on players you've already sold out of

---

## How Scouts Fit the Bigger Economy

Scouts produce inventory that flows into the rest of your account:

```
Scout → Player shares → Hold / Sell / Stack / Boost
```

- **Hold** for price appreciation
- **Sell** to realize SB
- **Stack** to convert raw shares into boost-ready multipliers
- **Use in boosts** to earn game-window payouts

Scouts are the upstream supply engine. The better your scout allocation, the better your downstream options.

---

## What Scouts Are Not

- ❌ Guaranteed profit
- ❌ Instant cash
- ❌ A replacement for active trading
- ❌ Equally useful no matter how many players you spread them across

They're a compounding inventory tool. The users who treat them that way get the most value.

---

## Next Steps

- [Stacking and Boosts](/wiki/gameplay/stacking-shares-and-boosts) — what to do with the shares scouts build
- [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings) — see your scout-earned inventory
- [Premium](/wiki/features/premium) — expand to 10 scouts
