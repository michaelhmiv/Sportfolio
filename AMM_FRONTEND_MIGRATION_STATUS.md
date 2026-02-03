# AMM Frontend Migration - Complete Status Report

## ✅ COMPLETED

### 1. Player Detail Page (`client/src/pages/player.tsx`)
**Status:** ✅ FULLY REPLACED

**What was removed:**
- ❌ Order book interface definition
- ❌ Order book display (bids/asks columns)
- ❌ Limit order form
- ❌ Market order preview
- ❌ Order type tabs (Limit/Market)
- ❌ Limit price input
- ❌ Order placement mutation
- ❌ Order book WebSocket subscription

**What was added:**
- ✅ AMM Pool data interface
- ✅ AMM Pool info card showing:
  - Pool shares
  - Pool liquidity
  - Total volume & trades
  - User's LP position (if any)
- ✅ `AmmTradePanel` component integration
- ✅ Trade WebSocket subscription
- ✅ Portfolio WebSocket subscription

### 2. Backend Infrastructure
**Status:** ✅ COMPLETE

**Files created:**
- `server/amm/pool.ts` - Core AMM + LP logic
- `server/routes/amm.ts` - AMM API endpoints
- `server/routes/lp.ts` - LP API endpoints
- `migrations/0013_amm_migration.sql` - Initial AMM migration
- `migrations/0014_lp_system.sql` - LP system migration

**Files modified:**
- `shared/schema.ts` - Added playerPools, lpPositions, lpTransactions tables
- `server/storage.ts` - Added LP storage methods
- `server/routes.ts` - Registered new routes
- `server/jobs/scheduler.ts` - Disabled bot engine

### 3. Portfolio Page
**Status:** ✅ PARTIALLY UPDATED

**Completed:**
- ✅ Added LP positions query
- ✅ Holdings display shows "(X in pool)" next to quantity
- ✅ Shows LP shares in holdings table

**Still needs:**
- ❌ Remove "Open Orders" tab (lines 1380-1445)
- ❌ Remove cancel order mutation (line 220)
- ❌ Remove bid/ask columns from holdings table
- ❌ Remove bid/ask sorting options

---

## ❌ STILL NEEDS UPDATING

### 1. Marketplace Page (`client/src/pages/marketplace.tsx`)
**Priority:** CRITICAL
**Lines to change:** 100+ references

**Remove:**
```typescript
// Type definitions
bestBid: string | null;
bestAsk: string | null;
bidSize: number;
askSize: number;

// Sort options
'bid' | 'ask' from SortField

// Filter state
filterHasBuyOrders
filterHasSellOrders

// API params
hasBuyOrders
hasSellOrders

// Table columns
Bid column
Ask column
```

**Replace with:**
```typescript
// Show AMM pool price only
ammPrice: number;

// Show pool liquidity
poolLiquidity: number;
```

### 2. Portfolio Page (`client/src/pages/portfolio.tsx`)
**Priority:** CRITICAL
**Lines to change:** 50+ references

**Remove:**
```typescript
// Open Orders tab (lines 1380-1445)
<TabsContent value="orders">
  {data?.openOrders.map((order) => (...))}
</TabsContent>

// Cancel order mutation (line 220)
const cancelOrderMutation = useMutation(...)

// Bid/Ask columns (lines ~1130-1160)
<td className="...">{group.bestBid}</td>
<td className="...">{group.bestAsk}</td>

// Sort by bid/ask (lines ~94, 361, 496, 856)
case 'bid':
case 'ask':
```

**Replace with:**
- Show AMM pool price
- Remove order-related UI entirely

### 3. Premium Trade Page (`client/src/pages/premium-trade.tsx`)
**Priority:** HIGH
**Lines to change:** 80+ references

**Remove:**
- Order book display (lines 351-421)
- Limit order form
- Order type tabs
- Price input for limit orders

**Replace with:**
- AMM trading interface (or disable premium trading as planned)

### 4. Market Activity Widget (`client/src/components/market-activity-widget.tsx`)
**Priority:** MEDIUM

**Remove:**
```typescript
activityType: "order_placed" | "order_cancelled"
```

**Keep:**
```typescript
activityType: "trade"
```

### 5. WebSocket Handler (`client/src/lib/websocket.tsx`)
**Priority:** MEDIUM

**Remove:**
```typescript
case 'orderBook':
  debouncedInvalidatePlayer(message.playerId);
```

**Keep:**
```typescript
case 'trade':
case 'portfolio':
case 'marketActivity':
```

### 6. API Endpoint Calls
**Priority:** CRITICAL

**Remove/Replace these API calls:**
```typescript
// Player page (COMPLETED)
/api/orders/${id}/preview -> /api/amm/${id}/quote
/api/orders/${id} -> /api/amm/${id}/buy or /sell

// Portfolio page
/api/orders/${orderId}/cancel -> REMOVE (AMM has no cancel)

// Marketplace page
/api/players?hasBuyOrders=true -> REMOVE
/api/players?hasSellOrders=true -> REMOVE
```

---

## 📋 DETAILED REPLACEMENT CHECKLIST

### File-by-File Breakdown

#### ✅ `client/src/pages/player.tsx` (DONE)
- [x] Replace orderBook with ammPool data
- [x] Remove limit order form
- [x] Integrate AmmTradePanel
- [x] Update WebSocket subscriptions
- [x] Remove order placement mutation
- [x] Remove order book display

#### ❌ `client/src/pages/portfolio.tsx` (PARTIAL)
- [x] Add LP positions display
- [ ] Remove "Open Orders" tab
- [ ] Remove cancel order functionality
- [ ] Remove bid/ask columns
- [ ] Remove bid/ask sorting
- [ ] Update to show AMM price only

#### ❌ `client/src/pages/marketplace.tsx` (NOT STARTED)
- [ ] Remove PlayerWithOrderBook type
- [ ] Remove bid/ask from SortField
- [ ] Remove hasBuyOrders/hasSellOrders filters
- [ ] Remove bid/ask columns from table
- [ ] Update to show AMM pool price
- [ ] Remove order book filters UI

#### ❌ `client/src/pages/premium-trade.tsx` (NOT STARTED)
- [ ] Remove order book display
- [ ] Remove limit order form
- [ ] Replace with AMM or disable

#### ❌ `client/src/components/market-activity-widget.tsx` (NOT STARTED)
- [ ] Remove order_placed/order_cancelled types
- [ ] Update activity display logic

#### ❌ `client/src/lib/websocket.tsx` (NOT STARTED)
- [ ] Remove orderBook message handler

---

## 🎯 RECOMMENDED APPROACH

Given the complexity, I recommend this implementation order:

### Phase 1: Critical Pages (DONE + Next)
1. ✅ Player detail page (DONE)
2. ❌ Portfolio page - Remove orders tab, update holdings display
3. ❌ Marketplace page - Replace bid/ask with AMM price

### Phase 2: Supporting Components
4. ❌ Premium trade page
5. ❌ Market activity widget
6. ❌ WebSocket cleanup

### Phase 3: Polish
7. ❌ Update onboarding text
8. ❌ Update FAQ/help text
9. ❌ Remove old order book backend code (optional)

---

## 📊 CURRENT STATUS

**Backend:** ✅ 100% Complete
- AMM pools working
- LP system working
- Fee structure (1%+1%) implemented
- API endpoints ready

**Frontend:** ⚠️ 30% Complete
- Player page: ✅ Complete
- Portfolio page: ⚠️ Partial
- Marketplace: ❌ Not started
- Premium trade: ❌ Not started
- Activity widget: ❌ Not started

**Build Status:** ✅ PASSING
- TypeScript compiles
- No breaking errors

---

## 🚀 WHAT WORKS NOW

1. **AMM Trading** - Users can trade instantly via `/api/amm/:playerId/buy|sell`
2. **LP Management** - Users can add/remove liquidity
3. **Player Page** - Shows AMM pool info, no order book
4. **Portfolio** - Shows LP positions in holdings

## ⚠️ WHAT STILL SHOWS OLD UI

1. **Portfolio** - Still has "Open Orders" tab (will show empty)
2. **Marketplace** - Still shows bid/ask columns (may show null)
3. **Premium Trade** - Still has limit order form

---

## 💡 ESTIMATED REMAINING WORK

- Portfolio page updates: 1-2 hours
- Marketplace page updates: 2-3 hours
- Premium trade updates: 1-2 hours
- Activity widget updates: 30 minutes
- WebSocket cleanup: 30 minutes
- Testing: 1-2 hours

**Total: 6-10 hours of focused work**

The foundation is solid - the AMM backend is production-ready. The remaining work is primarily removing old UI components and replacing them with AMM-focused displays.
