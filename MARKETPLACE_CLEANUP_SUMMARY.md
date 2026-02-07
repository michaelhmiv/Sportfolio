# Marketplace Page Cleanup Summary

## Current Status

The marketplace page has extensive order book references that need removal. Due to the complexity and number of references (50+), this requires significant refactoring.

## Key Changes Needed

### 1. Type Definitions

```typescript
// REMOVE:
type PlayerWithOrderBook = Player & {
  bestBid: string | null;
  bestAsk: string | null;
  bidSize: number;
  askSize: number;
};

// REPLACE WITH:
type PlayerWithPool = Player & {
  poolPrice?: number;
  poolLiquidity?: number;
};
```

### 2. Sort Fields

```typescript
// REMOVE "bid" | "ask":
type SortField =
  | "price"
  | "volume"
  | "change"
  | "liquidity"
  | "marketCap"
  | "sentiment"
  | "undervalued";
```

### 3. State Variables to Remove

- `filterHasBuyOrders` / `setFilterHasBuyOrders`
- `filterHasSellOrders` / `setFilterHasSellOrders`

### 4. URL Parameter Handling

Remove lines 71-79:

```typescript
if (sortBy === "bid") {
  setFilterHasBuyOrders(true);
}
if (sortBy === "ask") {
  setFilterHasSellOrders(true);
}
```

### 5. API Parameters

Remove lines 294-297:

```typescript
if (filterHasBuyOrders) params.append("hasBuyOrders", "true");
if (filterHasSellOrders) params.append("hasSellOrders", "true");
```

### 6. Filter UI (Lines ~440-470)

Remove:

- "Has Buy Orders" checkbox
- "Has Sell Orders" checkbox
- Related filter clear buttons

### 7. Sort Buttons (Lines ~510-540)

Remove:

- Bid sort button
- Ask sort button

### 8. Table Headers (Lines ~680-710)

Remove:

- Bid column header
- Ask column header

### 9. Table Cells (Lines ~830-870)

Remove:

- Bid price cells
- Ask price cells

### 10. Premium Market Data

Remove bestBid/bestAsk references in premium share display.

## Recommendation

Due to the complexity (50+ references across 900+ lines), I recommend:

1. **Option A**: Create a new simplified marketplace page from scratch (~2 hours)
   - Copy structure from current page
   - Remove all order book features
   - Keep: player list, search, filters, sorting (without bid/ask)
   - Add: AMM pool price display

2. **Option B**: Continue line-by-line editing (~4-5 hours)
   - More tedious but preserves exact structure
   - Higher risk of missing references

## Current Blockers

The file has too many interconnected references to safely edit line-by-line without breaking the build repeatedly.

**Recommendation**: Proceed with Option A (rewrite) for cleaner, faster results.
