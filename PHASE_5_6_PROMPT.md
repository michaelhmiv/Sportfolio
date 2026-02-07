# COMPREHENSIVE PROMPT: PHASE 5 & 6 - COLLECTION, PROGRESSION & UI JUICE

## Context

You are completing the gamification system for Sportfolio, a fantasy sports trading platform. Phases 3 and 4 have been successfully implemented. You must implement Phase 5 (Collection & Progression) and Phase 6 (UI Juice & Atmosphere) to complete the project.

## CRITICAL: Review Existing Work First

### Previously Implemented Components (STUDY THESE FOR PATTERNS):

**Ceremony Components** (in `client/src/components/ceremonies/`):

- `entry-draft-animation.tsx` - Cards deal with 3D flip, spring physics
- `boost-results-podium.tsx` - Tier-based results display
- `scout-ceremony-overlay.tsx` - Data harvesting ceremony
- `boost-ceremony-overlay.tsx` - Boost assignment ceremony

**Animation Patterns** (from existing code):

```typescript
// Spring physics (REQUIRED for all animations)
transition={{
  type: "spring",
  stiffness: 300,
  damping: 25,
}}

// Timing standards
// Micro: 0.2s
// Feedback: 0.4s
// Ceremony: 0.8-1s

// All ceremonies MUST be skippable
onClick={handleSkip} on overlay backdrop
```

**Color System** (STRICT - use these exact colors):

- Emerald (#10B981): Success, payouts, positive trends
- Amber (#F59E0B): Scout, boosts, warnings
- Violet (#8B5CF6): Power levels, premium
- Blue (#3B82F6): Data, info
- Red (#EF4444): Urgency, errors, negative trends

**WebSocket Pattern** (from `client/src/lib/websocket.tsx`):

```typescript
case 'event_type':
  queryClient.setQueryData(['key'], data);
  break;
```

**Backend Pattern** (from `server/amm/pool.ts`):

- Whale alerts: Check thresholds, broadcast via WebSocket
- Database queries using Drizzle ORM
- Transaction safety with `db.transaction()`

---

## PHASE 5: COLLECTION & PROGRESSION (Priority: MEDIUM)

### 5.1 Team Collection Badges (2-3 days)

**User Story**: Users earn badges for collecting all players from a team or achieving collection milestones.

**Database Schema** (add to `shared/schema.ts`):

```typescript
export const userCollections = pgTable(
  "user_collections",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionType: varchar("collection_type", { length: 50 }).notNull(), // 'team', 'rookie', 'position', 'allstar'
    targetId: varchar("target_id").notNull(), // team abbreviation, position, etc.
    progress: integer("progress").notNull().default(0),
    total: integer("total").notNull(),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userTypeTargetIdx: uniqueIndex("user_collection_idx").on(
      table.userId,
      table.collectionType,
      table.targetId,
    ),
    userIdx: index("user_collections_user_idx").on(table.userId),
    completedIdx: index("user_collections_completed_idx").on(table.completed),
  }),
);
```

**Collection Types**:

1. **Team Collections**: "Lakers Squad", "Warriors Squad", etc.
   - Target: All active players from a specific team
   - Progress: Count of owned players / total active players on team
2. **Rookie Hunter**: Own 5+ rookies (players with isRookie flag or first season)
   - Target: 5 rookies
   - Progress: Owned rookies count

3. **Position Master**: Own players from all positions (PG, SG, SF, PF, C)
   - Target: At least 1 player from each position
   - Progress: Unique positions owned

4. **All-Star Collector**: Own 10+ all-star caliber players (marketCap > $1M or isAllStar flag)

**Frontend Components**:

Create `client/src/components/collections/collection-badge.tsx`:

```typescript
interface CollectionBadgeProps {
  collection: {
    type: string;
    targetId: string;
    progress: number;
    total: number;
    completed: boolean;
    completedAt?: Date;
  };
  size?: "sm" | "md" | "lg";
}

// Requirements:
// - Show progress bar for incomplete collections
// - Holographic shimmer effect when completed (use CSS gradient animation)
// - Team logo/icon when available
// - Click to view collection details
// - Spring animation on hover
```

Create `client/src/components/collections/collection-progress.tsx`:

```typescript
// Progress bar component with:
// - Animated fill (width transition)
// - Percentage display
// - Color coding based on completion %
// - "X of Y collected" text
```

Create `client/src/components/collections/collection-ceremony.tsx`:

```typescript
// Full-screen ceremony when collection completed
// - Confetti explosion
// - Badge reveal with 3D flip
// - "Collection Complete!" header
// - List of all collected players
// - Share button (optional)
// - Skippable (click anywhere)
// Duration: 3-4 seconds
```

**Backend Implementation**:

Add to `server/routes.ts`:

```typescript
// Get user's collections
app.get("/api/collections", isAuthenticated, async (req, res) => {
  const userId = getUserId(req);
  const collections = await db
    .select()
    .from(userCollections)
    .where(eq(userCollections.userId, userId))
    .orderBy(desc(userCollections.completed), desc(userCollections.updatedAt));
  res.json(collections);
});

// Get collection details
app.get("/api/collections/:type/:targetId", isAuthenticated, async (req, res) => {
  const { type, targetId } = req.params;
  const userId = getUserId(req);
  // Return collection + owned players in collection
});
```

Create `server/jobs/update-collections.ts`:

```typescript
// Job to check and update collection progress
// Run every 15 minutes
// Check each user's holdings against collection criteria
// Update progress, mark completed if 100%
// Broadcast completion via WebSocket
```

**Integration Points**:

- Add collection badges to Portfolio page (`client/src/pages/portfolio.tsx`)
- Add collection progress to User Profile (`client/src/pages/user-profile.tsx`)
- Trigger ceremony on collection completion

---

### 5.2 Portfolio Milestones (1-2 days)

**User Story**: Celebrate when users reach net worth milestones.

**Milestones**:

- $1,000 - "First Thousand"
- $10,000 - "Ten K Club"
- $100,000 - "Six Figures"
- $1,000,000 - "Millionaire"
- $10,000,000 - "Ten Million"

**Database Schema** (add to `shared/schema.ts`):

```typescript
export const userMilestones = pgTable(
  "user_milestones",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    milestoneType: varchar("milestone_type", { length: 50 }).notNull(), // 'netWorth', 'portfolioValue', 'totalTrades'
    threshold: decimal("threshold", { precision: 20, scale: 2 }).notNull(),
    achievedAt: timestamp("achieved_at").notNull().defaultNow(),
    celebrated: boolean("celebrated").notNull().default(false),
  },
  (table) => ({
    userTypeThresholdIdx: uniqueIndex("user_milestone_idx").on(
      table.userId,
      table.milestoneType,
      table.threshold,
    ),
  }),
);
```

**Frontend Components**:

Create `client/src/components/milestones/milestone-ceremony.tsx`:

```typescript
interface MilestoneCeremonyProps {
  milestone: {
    type: string;
    threshold: number;
    title: string;
  };
  isOpen: boolean;
  onClose: () => void;
}

// Requirements:
// - Full-screen overlay
// - Massive confetti explosion (use canvas-confetti)
// - Large animated number counting up to milestone
// - Badge/trophy reveal
// - "[User] achieved [Milestone]!" text
// - Share to social media buttons
// - Skippable
// Duration: 4-5 seconds
```

Create `client/src/components/milestones/milestone-badge.tsx`:

```typescript
// Small badge showing achieved milestones
// Display in profile header
// Hover to see milestone details
// Stack multiple badges horizontally
```

**Backend Implementation**:

Create `server/jobs/check-milestones.ts`:

```typescript
// Check user net worth against milestones
// Run every 5 minutes
// Create milestone record when threshold crossed
// Broadcast celebration event via WebSocket if not celebrated
```

Add WebSocket type:

```typescript
| 'milestone_achieved' // User achieved milestone
```

**Integration Points**:

- Check milestones when portfolio value updates
- Show ceremony on dashboard when milestone achieved
- Display badges in user profile header

---

## PHASE 6: UI JUICE & ATMOSPHERE (Priority: MEDIUM)

### 6.1 Button "Juice" (1 day)

**User Story**: All primary buttons should feel premium and responsive.

**Create `client/src/components/ui/juicy-button.tsx`**:

```typescript
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface JuicyButtonProps extends React.ComponentPropsWithoutRef<typeof Button> {
  glowColor?: string;
  successState?: boolean;
  loadingState?: boolean;
}

export function JuicyButton({
  children,
  glowColor = "rgba(16, 185, 129, 0.5)", // emerald-500
  successState = false,
  loadingState = false,
  className,
  ...props
}: JuicyButtonProps) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
      }}
      className="relative"
    >
      {/* Glow effect on hover */}
      <motion.div
        className="absolute inset-0 rounded-md opacity-0"
        whileHover={{ opacity: 1 }}
        style={{
          background: `radial-gradient(circle at center, ${glowColor}, transparent 70%)`,
          filter: "blur(8px)",
        }}
      />

      <Button
        className={cn(
          "relative transition-all duration-200",
          successState && "bg-emerald-500 hover:bg-emerald-600",
          className
        )}
        {...props}
      >
        <AnimatePresence mode="wait">
          {loadingState ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading...</span>
            </motion.div>
          ) : successState ? (
            <motion.div
              key="success"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>Success!</span>
            </motion.div>
          ) : (
            <motion.div
              key="default"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </Button>
    </motion.div>
  );
}
```

**Requirements**:

- Scale to 0.95 on press (spring physics)
- Glow pulse on hover (subtle, not overwhelming)
- Success state morphs to checkmark
- Loading state with spinner
- AnimatePresence for smooth state transitions
- Replace primary buttons throughout app gradually

---

### 6.2 Number Counter Animation (1 day)

**User Story**: Portfolio values should animate smoothly when they change.

**Create `client/src/components/ui/animated-counter.tsx`**:

```typescript
import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";

interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
  flashOnChange?: boolean;
}

export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  decimals = 2,
  duration = 0.5,
  className,
  flashOnChange = true,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isFlashing, setIsFlashing] = useState(false);
  const previousValue = useRef(value);

  useEffect(() => {
    if (value !== previousValue.current) {
      const startValue = previousValue.current;
      const endValue = value;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / (duration * 1000), 1);

        // Ease out cubic
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = startValue + (endValue - startValue) * easeOut;

        setDisplayValue(current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setDisplayValue(endValue);
          previousValue.current = endValue;
        }
      };

      requestAnimationFrame(animate);

      if (flashOnChange) {
        setIsFlashing(true);
        setTimeout(() => setIsFlashing(false), 500);
      }
    }
  }, [value, duration, flashOnChange]);

  const isPositive = value > previousValue.current;
  const isNegative = value < previousValue.current;

  return (
    <motion.span
      className={cn(
        "inline-block tabular-nums",
        isFlashing && isPositive && "text-emerald-500",
        isFlashing && isNegative && "text-red-500",
        className
      )}
      animate={isFlashing ? { scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 0.3 }}
    >
      {prefix}{displayValue.toFixed(decimals)}{suffix}
    </motion.span>
  );
}
```

**Integration Points**:

- Replace static portfolio values in header
- Replace balance displays
- Replace P&L numbers
- Replace leaderboard values

---

### 6.3 Market Pulse (1-2 days)

**User Story**: Create ambient atmosphere that responds to market activity.

**Create `client/src/components/market/market-pulse.tsx`**:

```typescript
// Ambient background that responds to trading volume
// - Subtle gradient shifts based on market activity
// - Darker during evening games (6pm-11pm ET)
// - Pulse animation speed based on volume

interface MarketPulseProps {
  children: React.ReactNode;
}

export function MarketPulse({ children }: MarketPulseProps) {
  const [activityLevel, setActivityLevel] = useState(0); // 0-100
  const [isEvening, setIsEvening] = useState(false);

  useEffect(() => {
    // Check if evening (6pm-11pm ET)
    const checkTime = () => {
      const et = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      const hour = new Date(et).getHours();
      setIsEvening(hour >= 18 && hour <= 23);
    };

    // Fetch market activity level
    const fetchActivity = async () => {
      try {
        const res = await fetch("/api/market/activity");
        if (res.ok) {
          const data = await res.json();
          setActivityLevel(data.activityLevel);
        }
      } catch (error) {
        console.error("Failed to fetch market activity:", error);
      }
    };

    checkTime();
    fetchActivity();

    const timeInterval = setInterval(checkTime, 60000); // Check every minute
    const activityInterval = setInterval(fetchActivity, 30000); // Update every 30s

    return () => {
      clearInterval(timeInterval);
      clearInterval(activityInterval);
    };
  }, []);

  return (
    <div className="relative min-h-screen">
      {/* Animated background gradient */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-0"
        animate={{
          background: isEvening
            ? "radial-gradient(ellipse at top, rgba(15, 23, 42, 0.8), transparent 70%)"
            : "radial-gradient(ellipse at top, rgba(16, 185, 129, 0.03), transparent 70%)",
        }}
        transition={{ duration: 2 }}
      />

      {/* Activity pulse overlay */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-0 opacity-30"
        animate={{
          opacity: [0.1, 0.2 + (activityLevel / 500), 0.1],
        }}
        transition={{
          duration: 3 - (activityLevel / 50), // Faster pulse with higher activity
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.1), transparent 60%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
```

**Backend Endpoint**:

Add to `server/routes.ts`:

```typescript
app.get("/api/market/activity", async (req, res) => {
  try {
    // Calculate activity level based on trades in last 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const recentTrades = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .where(gte(trades.executedAt, fifteenMinutesAgo));

    const tradeCount = recentTrades[0]?.count || 0;

    // Normalize to 0-100 scale (assume 100 trades = max activity)
    const activityLevel = Math.min((tradeCount / 100) * 100, 100);

    res.json({
      activityLevel,
      tradeCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

**Breaking News Banner** (Optional enhancement):

Create `client/src/components/market/breaking-news-banner.tsx`:

```typescript
// Top banner for significant market events
// - Large trades (>$50k)
// - Player price movements (>20% in 1 hour)
// - New contests available
// - Auto-dismiss after 10 seconds
// - Manual close button
```

---

## IMPLEMENTATION ORDER

### Week 1: Phase 5

1. **Day 1-2**: Database schema updates (userCollections, userMilestones)
2. **Day 3-4**: Team Collection Badges (frontend + backend)
3. **Day 5**: Portfolio Milestones (frontend + backend)
4. **Day 6-7**: Integration and testing

### Week 2: Phase 6

1. **Day 1**: Juicy Button component + replace primary buttons
2. **Day 2**: Animated Counter component + integrate in portfolio/header
3. **Day 3-4**: Market Pulse background + activity tracking
4. **Day 5-7**: Testing, polish, and bug fixes

---

## CRITICAL REQUIREMENTS CHECKLIST

### Style Compliance

- [ ] All animations use spring physics (stiffness: 300-400, damping: 20-25)
- [ ] NO bouncy easing functions
- [ ] Timing: Micro (0.2s), Feedback (0.4s), Ceremony (0.8-1s)
- [ ] All ceremonies skippable
- [ ] Mobile responsive (test on <768px)
- [ ] Colors: Emerald, Amber, Violet, Blue, Red only

### Technical Requirements

- [ ] TypeScript strict mode compliance
- [ ] All WebSocket events added to `server/websocket.ts`
- [ ] All WebSocket handlers added to `client/src/lib/websocket.tsx`
- [ ] Database migrations created for new tables
- [ ] API endpoints follow REST conventions
- [ ] Jobs registered in scheduler

### Testing Requirements

- [ ] Run `npx tsc --noEmit` in client and server
- [ ] Run `npm run build` for production build
- [ ] Test all animations work smoothly
- [ ] Test skip functionality on all ceremonies
- [ ] Test mobile responsiveness
- [ ] Verify no console errors

### Files to Create (Estimated)

**New Components (12 files)**:

1. `client/src/components/collections/collection-badge.tsx`
2. `client/src/components/collections/collection-progress.tsx`
3. `client/src/components/collections/collection-ceremony.tsx`
4. `client/src/components/collections/collection-list.tsx`
5. `client/src/components/milestones/milestone-ceremony.tsx`
6. `client/src/components/milestones/milestone-badge.tsx`
7. `client/src/components/ui/juicy-button.tsx`
8. `client/src/components/ui/animated-counter.tsx`
9. `client/src/components/market/market-pulse.tsx`
10. `server/jobs/update-collections.ts`
11. `server/jobs/check-milestones.ts`

**Modified Files (8 files)**:

1. `shared/schema.ts` - Add userCollections, userMilestones tables
2. `server/routes.ts` - Add collection and milestone endpoints
3. `server/websocket.ts` - Add new subscription types
4. `client/src/lib/websocket.tsx` - Add handlers for new events
5. `client/src/pages/portfolio.tsx` - Add collection badges
6. `client/src/pages/user-profile.tsx` - Add milestone badges
7. `client/src/App.tsx` - Add MarketPulse wrapper
8. `server/jobs/scheduler.ts` - Register new jobs

---

## REFERENCE: Existing Component Patterns

### From `entry-draft-animation.tsx`:

```typescript
// 3D card flip with preserve-3d
style={{ transformStyle: "preserve-3d" }}

// Staggered children
animate={{ delay: index * 0.1 }}

// Skippable overlay
onClick={handleSkip}
className="... backdrop-blur-sm"
```

### From `whale-alert-banner.tsx`:

```typescript
// Wave animation
animate={{ x: ["-100%", "100%"] }}
transition={{ duration: 3, repeat: Infinity, ease: "linear" }}

// Progress bar countdown
animate={{ width: "0%" }}
transition={{ duration: 8, ease: "linear" }}
```

### From `boost-results-podium.tsx`:

```typescript
// Spring entrance
initial={{ opacity: 0, y: 50, scale: 0.9 }}
animate={{ opacity: 1, y: 0, scale: 1 }}
transition={{ type: "spring", stiffness: 300, damping: 25, delay }}

// Staggered reveal
{podiumOrder.map((winner, index) => (
  <PodiumCard key={winner.rank} winner={winner} delay={index * 0.15} />
))}
```

---

## SUCCESS CRITERIA

1. **All Phase 5 features work**:
   - Users can view collection progress
   - Collections complete automatically when criteria met
   - Collection ceremony plays on completion
   - Milestones trigger celebration
   - Badges display in profile

2. **All Phase 6 features work**:
   - Buttons have juice (scale, glow, states)
   - Numbers animate smoothly
   - Market pulse responds to activity
   - Evening mode darkens theme

3. **No regressions**:
   - Existing phases 3 & 4 still work
   - No console errors
   - TypeScript compiles
   - Production build succeeds

4. **Performance**:
   - Animations run at 60fps
   - No layout shifts
   - Mobile performance acceptable

---

## QUESTIONS FOR USER (if unclear)

1. Should collection badges be visible to other users or just the owner?
2. What defines a "rookie" player? (first season flag, age, etc.)
3. Should milestone celebrations be broadcast to other users?
4. What constitutes "evening" for theme darkening? (6pm-11pm ET?)
5. Should breaking news banner be implemented or is Market Pulse sufficient?

---

## DELIVERABLES

By end of this phase, you should have:

1. ✅ All 12 new components created
2. ✅ All 8 files modified correctly
3. ✅ Database schema updated with migrations
4. ✅ All WebSocket events working
5. ✅ Jobs running on schedule
6. ✅ Integration complete in portfolio and profile pages
7. ✅ Test report documenting all features
8. ✅ No TypeScript errors
9. ✅ Production build succeeds
10. ✅ All animations smooth and skippable

**Remember**: When in doubt, study the existing ceremony components. Match their patterns exactly for consistency.
