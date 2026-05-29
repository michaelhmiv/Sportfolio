# Bot Engine v2 — Deterministic Market Simulation

## Goal

Replace the 4,108-line LLM-based bot runtime with a simple, deterministic, profile-driven engine that:
- Earns its way in through scouting (just like real users)
- Creates pools organically
- Generates realistic market activity
- Never gets stuck in repetitive loops

---

## Current State (May 2026)

- 12 bot profiles exist, all `is_active=False`
- 15 bot user accounts with $10K starting balance each (same as real users)
- Zero scout assignments, zero holdings, zero trades
- Only 2 player pools exist (out of 4,196 active players)
- Scout distribution job runs hourly (when scouts are assigned)
- App is online on Railway at sportfolio.market

---

## Architecture: State Machine Per Bot

Each bot operates in one of four lifecycle stages. The stage determines available actions.

```
┌──────────────┐     hourly distributions      ┌──────────────────┐
│  SCOUTING    │ ──────────────────────────────>│  ACCUMULATING    │
│  (Day 0)     │   shares appear in holdings    │  (Day 0-2)      │
└──────────────┘                                └──────────────────┘
                                                        │
                                         has shares + SB │
                                                        ▼
┌──────────────┐     enough liquidity           ┌──────────────────┐
│  STEADY      │ <─────────────────────────────│  POOL BUILDING   │
│  STATE       │   multiple pools, positions    │  (Day 1-5)      │
└──────────────┘                                └──────────────────┘
```

### Stage: SCOUTING (boot)
- **Actions**: Assign scouts only
- **Transition**: When bot has ≥1 share of any player → ACCUMULATING
- **Duration**: 1-3 hours (first distribution)

### Stage: ACCUMULATING (building inventory)
- **Actions**: Assign/rebalance scouts, buy shares (if pools exist)
- **Transition**: When bot has shares of ≥3 players AND balance > $5K → POOL_BUILDING
- **Duration**: 1-3 days

### Stage: POOL_BUILDING (creating markets)
- **Actions**: All of above + create pools via addLiquidity
- **Transition**: When bot has ≥5 LP positions or ≥10 pools created → STEADY_STATE
- **Duration**: 3-7 days

### Stage: STEADY_STATE (full participation)
- **Actions**: Scout, trade, LP, boost — full user behavior
- **Duration**: Indefinite

---

## Anti-Loop Mechanisms

### 1. Player Cooldown Map

Each bot maintains a per-player cooldown:
```
playerCooldowns: Map<playerId, lastInteractionTimestamp>
```

Rules:
- After any action on a player, cooldown = `6-24h` (varies by bot role)
- Bot CANNOT interact with a cooled-down player
- Exception: scout distribution doesn't trigger cooldown (passive)

### 2. Sport Rotation

Track actions per sport in a rolling 24h window:
```
sportActionCounts: { MLB: 3, NBA: 2, NFL: 1, NASCAR: 0 }
```

Rules:
- On each tick, prefer the sport with LOWEST recent action count
- Never exceed 60% of actions on a single sport
- If only one sport has eligible players, allow but flag

### 3. Action Type Diversity

Track action types in a rolling 24h window:
```
actionTypeCounts: { scout_assign: 5, pool_create: 3, buy: 2, sell: 1, boost: 0 }
```

Rules:
- Each tick, PREFER the least-used action type that the bot's current stage allows
- Market makers must maintain ≥30% LP actions
- Traders must maintain ≥40% buy+sell actions
- No more than 3 consecutive same-type actions

### 4. Position Size Limits

Per-player exposure cap:
- No more than 15% of total portfolio value in a single player
- No more than 30% in a single sport
- If limit reached, bot MUST diversify before acting on that player again

### 5. Global Coordination (Bot Awareness)

Before acting, check `bot_actions_log` for recent activity by OTHER bots:
- If another bot interacted with the same player in the last 2 hours → skip
- If more than 3 bots are all targeting the same sport this tick → diversify
- Exception: different action types on same player are allowed (one bot buys, another LPs)

### 6. Randomized Jitter

- Each bot's tick timing: base_interval ± random(0-30% of interval)
- Order sizes: target_size × random(0.7 - 1.3)
- Player selection: weighted random, not strict top-1

---

## Bot Profiles (Deterministic Behavior)

### Market Maker (2 bots)
- **Priority**: Pool creation → LP adds → price continuity
- **Scout strategy**: Spread across 8-10 players with NO pools, rotate weekly
- **Pool creation**: Create pools at fair value price (FP × $0.50)
- **Trading**: Small buys on cold pools to show price movement
- **Cooldown**: 8h per player
- **Max daily actions**: 20
- **Risk**: Low (small positions, wide spread)

### Trader (4 bots)
- **Priority**: Buy undervalued → sell overvalued → react to momentum
- **Scout strategy**: Focus 3-5 high-value players (tier 1-2)
- **Pool creation**: Only when sitting on accumulated shares with no pool
- **Trading**: Buy when price < fair value by 10%+, sell when > 10%
- **Cooldown**: 12h per player
- **Max daily actions**: 10-15
- **Risk**: Medium (directional bets, but size-limited)

### Casual (2 bots)
- **Priority**: Random exploration → small positions → organic-looking
- **Scout strategy**: Random players, change 1-2 scouts per day
- **Pool creation**: Opportunistic (when shares accumulate)
- **Trading**: Small random buys, occasional sells to take profit
- **Cooldown**: 24h per player
- **Max daily actions**: 5-8
- **Risk**: Very low (tiny positions, max variety)

### Contest/Boost Specialist (2 bots)
- **Priority**: Accumulate shares → stack → boost around game windows
- **Scout strategy**: Players with upcoming games (next 48h)
- **Pool creation**: Rare (only excess shares)
- **Trading**: Buy before games, sell/hold after
- **Boost**: Actively assign boost slots before game lock
- **Cooldown**: 12h per player (trading), none for boosts
- **Max daily actions**: 8-12 (spikes on game days)
- **Risk**: Medium (concentrated around events)

### Cold Market Specialist (2 bots)
- **Priority**: Find players with ZERO activity → scout → create first pool
- **Scout strategy**: Only targets players with no pool and no scouts
- **Pool creation**: Primary purpose — be the first LP for forgotten players
- **Trading**: Minimal (just enough to show a price)
- **Cooldown**: 48h per player (these are long-term positions)
- **Max daily actions**: 5-8
- **Risk**: Low (very small initial positions)

---

## Tick Logic (Pseudocode)

```typescript
async function runBotTick(bot: BotProfile) {
  const stage = determineStage(bot);
  const eligibleActions = getActionsForStage(stage, bot.role);
  const recentActions = await getRecentBotActions(bot.userId, 24h);
  const otherBotActions = await getRecentOtherBotActions(24h);
  
  // 1. Pick action type (least-used that's eligible)
  const actionType = selectActionType(eligibleActions, recentActions);
  
  // 2. Pick target player (weighted random, respecting cooldowns + coordination)
  const player = selectTargetPlayer({
    actionType,
    botRole: bot.role,
    cooldowns: bot.playerCooldowns,
    otherBotActions,
    sportBalance: computeSportBalance(recentActions),
    positionLimits: computePositionLimits(bot),
  });
  
  if (!player) return; // NO_ACTION — nothing eligible this tick
  
  // 3. Determine parameters (size, price, etc.)
  const params = calculateActionParams(actionType, player, bot);
  
  // 4. Execute (through same internal AMM functions)
  const result = await executeAction(bot.userId, actionType, player.id, params);
  
  // 5. Log (uses existing bot_actions_log)
  await logAction(bot, actionType, player, params, result);
  
  // 6. Update cooldown
  if (result.success) {
    bot.playerCooldowns.set(player.id, Date.now());
  }
}
```

---

## Player Selection Algorithm

NOT random. Weighted scoring:

```
score = baseScore
  + (hasCooldown ? -9999 : 0)           // hard block
  + (otherBotTouched ? -500 : 0)        // soft block
  + (noPool ? +200 : 0)                 // cold market bonus
  + (hasUpcomingGame ? +100 : 0)        // event bonus
  + (undervalued ? +spreadPercent * 10 : 0)  // value signal
  + (sportDeficit ? +150 : 0)           // rotation bonus
  + (lowPositionSize ? +50 : 0)         // diversification bonus
  + random(0, 80)                       // jitter
```

Then select from top-3 candidates randomly (not always #1).

---

## Pool Pricing Strategy

When a bot creates the FIRST pool for a player:

```
initialPrice = fairValue OR fallbackPrice

fairValue = avgFantasyPoints(last10games) × $0.50 × momentumFactor
fallbackPrice = $10.00  (if no game stats available)

shares_to_deposit = min(available_shares, 5)
sb_to_deposit = shares_to_deposit × initialPrice
```

This sets a reasonable opening price based on actual performance data.

---

## Scheduler Integration

Keep using the existing `*/15 * * * *` cron schedule (every 15 min).

But each bot only acts 2-6 times per day (not every tick):
- On each tick, roll against bot's `actionProbability`:
  - Market Maker: 60% chance per tick (active)
  - Trader: 40% chance per tick
  - Casual: 15% chance per tick
  - Contest: 30% chance per tick (higher on game days)
  - Cold Market: 20% chance per tick

This means:
- Market Makers: ~58 actions/day (at 96 ticks × 60%)
- Wait, that's too many. Let me recalculate.

Actually with max_daily_actions caps:
- Even if probability fires every tick, the max daily cap stops them
- Market Maker: max 20/day → fires about every ~72 min
- Trader: max 15/day → fires about every ~96 min
- Casual: max 8/day → fires about every ~3h

---

## Implementation Files

### New files to create:
- `server/bot/deterministic-engine.ts` — main tick logic + state machine
- `server/bot/player-selector.ts` — weighted player selection with anti-loop
- `server/bot/action-executor.ts` — thin wrapper calling existing AMM/scout functions
- `server/bot/bot-profiles-v2.ts` — profile definitions with all knobs

### Existing files to modify:
- `server/bot/bot-engine.ts` — swap `runHermesBotEngineTick()` call to new engine
- `server/jobs/scheduler.ts` — keep same schedule, point to new engine
- `server/bot-seed.ts` — update profiles to match v2 roles

### Files to keep as-is:
- `server/amm/pool.ts` — execution layer (already transparent)
- `server/bot/player-valuation.ts` — fair value calculations (already great)
- `server/agent/executor.ts` — action execution (reuse for LP/scout/boost)
- `server/jobs/scout-distribution.ts` — hourly share distribution (unchanged)

### Files to archive (not delete):
- `server/bot/runtime.ts` — LLM-based planning (4,108 lines)
- `server/bot/trading-strategy.ts` — old random strategy

---

## Rollout Plan

### Day 0: Activate & Scout
1. Activate all 12 bot profiles (`is_active=True`)
2. Deploy new deterministic engine
3. Bots immediately assign scouts (5 per bot = 60 total scout slots across players)
4. Wait for first hourly distribution

### Day 1-2: First Shares Arrive
- Hourly distributions begin giving shares to bots
- Market Makers and Cold Market bots start creating pools as soon as they have ≥1 share + $10+ SB
- Initial prices set via fair value calculation
- Activity feed starts showing pool creation events

### Day 3-7: Market Comes Alive
- Traders begin buying/selling against pools
- Casuals add small random trades
- Contest bots start engaging with boost slots
- Price movement becomes visible
- More pools created as scouts earn more diverse shares

### Week 2+: Steady State
- Full market dynamics: buying, selling, LP, boosts
- 50-100+ pools active
- Daily trade volume from bots creates visible activity
- Real users joining see an active, functioning market

---

## Monitoring & Safeguards

### Kill Switch
- Environment variable `BOT_ENGINE_ENABLED=false` stops all bot activity
- Individual bots: `is_active` column in `bot_profiles`

### Metrics to Watch (via existing bot_actions_log)
- Actions per bot per day (should match expected range)
- Unique players touched per day (should grow, not shrink)
- Sport distribution (should be roughly proportional)
- Failure rate (should be <5% once pools exist)
- Position concentration (alert if >20% in one player)

### Circuit Breakers
- If a bot fails 5 consecutive actions → pause for 1 hour
- If total bot volume exceeds $50K/day → throttle all bots
- If a single player receives >10 bot actions in 24h → hard block that player for 48h
