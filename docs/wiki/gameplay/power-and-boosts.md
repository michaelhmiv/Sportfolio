---
id: gameplay-power-boosts
title: Power and Boosts
summary: How condense, power levels, daily boosts, and community boosts interact.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: server/routes.ts,shared/schema.ts,shared/vesting-utils.ts
slug: power-and-boosts
surface: web,cli,agent
searchKeywords: power,boosts,condense,daily boosts,community boosts
---

# Power is inventory quality

Not all shares are equal. A powered share carries a higher per-share multiplier than a raw share and matters directly in boost payout math.

# Condense converts raw shares into power

The condense flow burns regular shares and increases the power on a retained share. This is a deliberate trade: you reduce count to improve quality.

# Daily boosts

Daily boosts consume exactly one eligible share per slot. The selected share's power level matters, and the slot tier changes payout impact.

# Locks are real

Boost-related inventory can become unavailable around lock windows. Do not assume a share is freely reusable if it is already committed elsewhere.

# Community boosts

Community boosts change the multiplier environment for a player on a given day. They can improve the value of using that player in your own boost plan, but they still need to be judged against your opportunity cost.

# Practical advice

Think in terms of before-and-after inventory. If a move burns your best powered share, that is a real cost even if the immediate action looks attractive.
