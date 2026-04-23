---
id: feature-analytics
title: Analytics
summary: What the Sportfolio Analytics surface covers, how to read market health signals, and when to use analytics versus the live player view.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-04-23
changeTriggers: client/src/pages/analytics.tsx,server/routes.ts,shared/schema.ts
slug: analytics
surface: web,agent
searchKeywords: analytics,market health,charts,trends,economy,share issuance,burn,player comparison
---

# Analytics

Analytics is the macro view of Sportfolio's market ecosystem. Use it when you want to understand the overall state of the economy — not just a single player's price.

> 💡 **Analytics answers "what's happening in the market?"** Player pages answer "what's happening with this player?"

---

## What Analytics Covers

### Market Health

Overview metrics that show whether the overall market is growing, contracting, or stable:
- Active pool count and total TVL
- Aggregate trading volume over time
- Overall market sentiment indicators

### Share Issuance and Burn Trends

Track how shares are entering and leaving the supply:
- New shares minted through scout distributions
- Shares burned through boost assignments and the 1% burn fee on trades
- Net supply change over time

Understanding issuance vs. burn helps you gauge whether a player's market is in accumulation mode or deflationary mode.

### Time-Series Charts

See how key metrics have moved over time:
- Price history across player markets
- Volume trends by sport and date range
- Pool size (TVL) evolution

### Sport-Level Breakdowns

Compare market activity across NBA, NFL, MLB, and NASCAR:
- Which league is most active right now?
- Where is volume concentrated?
- How do different sports' markets behave during their respective seasons?

### Player Comparisons

Compare up to several players side-by-side across metrics like:
- Market cap
- Volume
- Price change
- Pool size

Useful for deciding between similar players or identifying which name has more market activity around it.

### Economy Snapshots

Point-in-time summaries of the whole Sportfolio economy:
- Total shares outstanding
- Total market capitalization
- Cash in circulation vs. cash deployed in pools

---

## When to Use Analytics

**Before making a large trade** — Check overall market conditions. Is the broader market in a healthy state, or is it thin and quiet?

**Comparing players** — Side-by-side comparison is faster in Analytics than bouncing between individual player pages.

**Spotting trends** — Volume spikes, price divergences, or unusual supply changes can signal opportunities worth investigating.

**Understanding your portfolio in context** — If your holdings are performing well but you don't know why, Analytics may reveal a broader market tailwind.

---

## What Analytics Is Not

Analytics is a context tool, not an execution surface. You can't trade from Analytics — it's for observation and analysis.

It also doesn't provide real-time tick-level data. It's a macro observability layer, not a trading terminal.

---

## Agent Access

You can ask the agent to summarize analytics-style questions:

```
"How is the NBA market looking today?"
"Which players have had the most volume this week?"
"Is there anything unusual happening in the market right now?"
```

The agent uses the same underlying data and can apply it to your specific holdings for personalized context.

---

## Next Steps

- [Player Pools](/wiki/gameplay/player-pools) — execute trades informed by analytics
- [Watchlists and News](/wiki/features/watchlists-and-news) — pair market data with news context
- [Sports and Slates](/wiki/gameplay/sports-and-slates) — understand how sport seasonality affects market behavior
