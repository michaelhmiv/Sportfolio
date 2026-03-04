# IMPLEMENTATION INSTRUCTIONS: PHASE 5 & 6

## AGENT ROLE

You are implementing the final gamification phases for Sportfolio. Follow these instructions precisely. Do not deviate from the patterns established in Phases 3 & 4.

---

## BEFORE YOU START

### Step 1: Review Existing Code

Read these files to understand the patterns:

1. `client/src/components/ceremonies/boost-results-podium.tsx` - Study ceremony structure
2. `client/src/components/ceremonies/entry-draft-animation.tsx` - Study animations
3. `client/src/components/market/whale-alert-banner.tsx` - Study WebSocket integration
4. `client/src/lib/websocket.tsx` - Study event handling
5. `server/amm/pool.ts` - Study backend patterns

### Step 2: Verify Build

Run these commands and ensure they pass:

```bash
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
npm run build
```

---

## PHASE 5: COLLECTION & PROGRESSION

### TASK 5.1: Database Schema Updates

**ACTION 1**: Add userCollections table to `shared/schema.ts`

Insert this after the scoutHistory table (around line 323):

```typescript
// User Collections - tracks collection progress (team, rookie, etc.)
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

**ACTION 2**: Add userMilestones table to `shared/schema.ts`

Insert this after userCollections:

```typescript
// User Milestones - tracks achievement milestones
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

**ACTION 3**: Add TypeScript types at end of `shared/schema.ts`

Add these export statements after existing type exports:

```typescript
export type UserCollection = typeof userCollections.$inferSelect;
export type InsertUserCollection = typeof userCollections.$inferInsert;
export type UserMilestone = typeof userMilestones.$inferSelect;
export type InsertUserMilestone = typeof userMilestones.$inferInsert;
```

**VERIFICATION**: Run `cd server && npx tsc --noEmit` - must pass with no errors.

---

### TASK 5.2: Create Collection Components

**ACTION 4**: Create directory structure

```bash
mkdir -p client/src/components/collections
mkdir -p client/src/components/milestones
```

**ACTION 5**: Create `client/src/components/collections/collection-badge.tsx`

Copy this exact code:

```typescript
import { motion } from "framer-motion";
import { Check, Trophy, Users, Star, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CollectionBadgeProps {
  collection: {
    id: string;
    collectionType: string;
    targetId: string;
    progress: number;
    total: number;
    completed: boolean;
    completedAt?: Date | null;
  };
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
}

const COLLECTION_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  team: { icon: Trophy, color: "text-blue-500", label: "Team" },
  rookie: { icon: Star, color: "text-amber-500", label: "Rookie" },
  position: { icon: Target, color: "text-violet-500", label: "Position" },
  allstar: { icon: Users, color: "text-emerald-500", label: "All-Star" },
};

export function CollectionBadge({
  collection,
  size = "md",
  showTooltip = true,
}: CollectionBadgeProps) {
  const config = COLLECTION_CONFIG[collection.collectionType] || COLLECTION_CONFIG.team;
  const Icon = config.icon;
  const progressPercent = Math.round((collection.progress / collection.total) * 100);

  const sizeClasses = {
    sm: "text-[10px] px-2 py-0.5 h-5",
    md: "text-xs px-2.5 py-1 h-6",
    lg: "text-sm px-3 py-1.5 h-7",
  };

  const content = (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <Badge
        variant="outline"
        className={cn(
          "relative overflow-hidden flex items-center gap-1.5 font-medium",
          collection.completed
            ? "bg-gradient-to-r from-amber-500/20 via-yellow-500/20 to-amber-500/20 border-amber-500/50"
            : "bg-card border-border",
          sizeClasses[size]
        )}
      >
        {/* Holographic shimmer effect for completed badges */}
        {collection.completed && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        )}

        <span className={cn("relative z-10", config.color)}>
          {collection.completed ? (
            <Check className="w-3 h-3" />
          ) : (
            <Icon className="w-3 h-3" />
          )}
        </span>

        <span className="relative z-10 truncate max-w-[100px]">
          {collection.targetId}
        </span>

        {!collection.completed && (
          <span className="relative z-10 text-muted-foreground text-[10px]">
            {collection.progress}/{collection.total}
          </span>
        )}
      </Badge>
    </motion.div>
  );

  if (!showTooltip) return content;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <p className="font-medium">{config.label}: {collection.targetId}</p>
          <p className="text-xs text-muted-foreground">
            {collection.completed
              ? `Completed ${collection.completedAt ? new Date(collection.completedAt).toLocaleDateString() : ""}`
              : `${collection.progress} of ${collection.total} collected (${progressPercent}%)`}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

**ACTION 6**: Create `client/src/components/collections/collection-ceremony.tsx`

Copy this exact code:

```typescript
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Trophy, Check, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";

interface CollectionCeremonyProps {
  isOpen: boolean;
  collection: {
    collectionType: string;
    targetId: string;
    progress: number;
    total: number;
  } | null;
  onClose: () => void;
}

export function CollectionCeremony({
  isOpen,
  collection,
  onClose,
}: CollectionCeremonyProps) {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (isOpen && collection) {
      setShowContent(false);

      // Trigger confetti explosion
      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

      const randomInRange = (min: number, max: number) =>
        Math.random() * (max - min) + min;

      const interval: any = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          colors: ["#10B981", "#F59E0B", "#8B5CF6", "#3B82F6"],
        });
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          colors: ["#10B981", "#F59E0B", "#8B5CF6", "#3B82F6"],
        });
      }, 250);

      // Show content after brief delay
      const timer = setTimeout(() => setShowContent(true), 500);

      // Auto-close after 5 seconds
      const closeTimer = setTimeout(() => onClose(), 5000);

      return () => {
        clearInterval(interval);
        clearTimeout(timer);
        clearTimeout(closeTimer);
      };
    }
  }, [isOpen, collection, onClose]);

  if (!isOpen || !collection) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="w-5 h-5" />
        </motion.button>

        <div
          className="w-full max-w-md mx-4 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatePresence>
            {showContent && (
              <>
                {/* Badge reveal with 3D flip */}
                <motion.div
                  initial={{ rotateY: -180, opacity: 0, scale: 0.5 }}
                  animate={{ rotateY: 0, opacity: 1, scale: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 200,
                    damping: 20,
                    duration: 0.8,
                  }}
                  style={{ transformStyle: "preserve-3d" }}
                  className="mb-8"
                >
                  <div className="w-32 h-32 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 via-yellow-400 to-amber-500 flex items-center justify-center shadow-2xl shadow-amber-500/30">
                    <Trophy className="w-16 h-16 text-white" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <h2 className="text-3xl font-bold mb-2">Collection Complete!</h2>
                  <p className="text-xl text-muted-foreground mb-6">
                    {collection.targetId}
                  </p>

                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 mb-8">
                    <Check className="w-5 h-5" />
                    <span className="font-medium">
                      {collection.progress} of {collection.total} collected
                    </span>
                  </div>

                  <div className="flex gap-3 justify-center">
                    <Button onClick={onClose}>Continue</Button>
                    <Button variant="outline" className="gap-2">
                      <Share2 className="w-4 h-4" />
                      Share
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-xs text-muted-foreground mt-8"
          >
            Click anywhere to skip
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

**VERIFICATION**: Check that both files compile without TypeScript errors.

---

### TASK 5.3: Create Milestone Components

**ACTION 7**: Create `client/src/components/milestones/milestone-ceremony.tsx`

Copy this exact code:

```typescript
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { Trophy, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import confetti from "canvas-confetti";

interface MilestoneCeremonyProps {
  isOpen: boolean;
  milestone: {
    type: string;
    threshold: number;
    title: string;
  } | null;
  onClose: () => void;
}

export function MilestoneCeremony({
  isOpen,
  milestone,
  onClose,
}: MilestoneCeremonyProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const [showContent, setShowContent] = useState(false);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (isOpen && milestone) {
      startTimeRef.current = Date.now();
      setShowContent(false);
      setDisplayValue(0);

      // Massive confetti explosion
      const end = Date.now() + 4000;
      const colors = ["#10B981", "#F59E0B", "#8B5CF6", "#3B82F6", "#EF4444"];

      (function frame() {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: colors,
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: colors,
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      })();

      // Animate number counting up
      const duration = 2000;
      const startValue = 0;
      const endValue = milestone.threshold;

      const animateNumber = (currentTime: number) => {
        const elapsed = currentTime - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = startValue + (endValue - startValue) * easeOut;
        setDisplayValue(current);

        if (progress < 1) {
          requestAnimationFrame(animateNumber);
        } else {
          setDisplayValue(endValue);
        }
      };

      // Start animations
      setTimeout(() => {
        setShowContent(true);
        requestAnimationFrame(animateNumber);
      }, 300);

      // Auto-close after 6 seconds
      const timer = setTimeout(() => onClose(), 6000);

      return () => clearTimeout(timer);
    }
  }, [isOpen, milestone, onClose]);

  if (!isOpen || !milestone) return null;

  const formatValue = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="w-5 h-5" />
        </motion.button>

        <div
          className="w-full max-w-lg mx-4 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatePresence>
            {showContent && (
              <>
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 200,
                    damping: 20,
                  }}
                  className="mb-6"
                >
                  <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-2xl shadow-emerald-500/30">
                    <Trophy className="w-12 h-12 text-white" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <h2 className="text-2xl font-bold mb-2 text-muted-foreground">
                    Milestone Achieved!
                  </h2>

                  <motion.div
                    className="text-6xl font-bold font-mono text-emerald-500 mb-4"
                    animate={{
                      scale: [1, 1.1, 1],
                    }}
                    transition={{
                      duration: 0.5,
                      delay: 2,
                    }}
                  >
                    {formatValue(displayValue)}
                  </motion.div>

                  <p className="text-xl mb-8">{milestone.title}</p>

                  <div className="flex gap-3 justify-center">
                    <Button onClick={onClose} size="lg">
                      Continue
                    </Button>
                    <Button variant="outline" size="lg" className="gap-2">
                      <Share2 className="w-4 h-4" />
                      Share
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-xs text-muted-foreground mt-8"
          >
            Click anywhere to skip
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

**ACTION 8**: Create `client/src/components/milestones/milestone-badge.tsx`

Copy this exact code:

```typescript
import { motion } from "framer-motion";
import { Trophy, TrendingUp, DollarSign, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MilestoneBadgeProps {
  milestone: {
    milestoneType: string;
    threshold: number;
    achievedAt: Date;
  };
  size?: "sm" | "md";
}

const MILESTONE_ICONS: Record<string, React.ElementType> = {
  netWorth: Trophy,
  portfolioValue: TrendingUp,
  cashBalance: DollarSign,
  totalTrades: BarChart3,
};

export function MilestoneBadge({ milestone, size = "md" }: MilestoneBadgeProps) {
  const Icon = MILESTONE_ICONS[milestone.milestoneType] || Trophy;

  const formatThreshold = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(0)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value}`;
  };

  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className={cn(
              "rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center cursor-pointer shadow-lg shadow-emerald-500/20",
              sizeClasses[size]
            )}
          >
            <Icon className="w-4 h-4 text-white" />
          </motion.div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{formatThreshold(Number(milestone.threshold))}</p>
          <p className="text-xs text-muted-foreground">
            Achieved {new Date(milestone.achievedAt).toLocaleDateString()}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

**VERIFICATION**: Both files must compile without errors.

---

### TASK 5.4: Backend Implementation

**ACTION 9**: Add API endpoints to `server/routes.ts`

Find the scout velocity endpoints (around line 7850) and add these after them:

```typescript
// Collection API Endpoints

// Get user's collections
app.get("/api/collections", isAuthenticated, async (req, res) => {
  try {
    const userId = getUserId(req);
    const collections = await db
      .select()
      .from(userCollections)
      .where(eq(userCollections.userId, userId))
      .orderBy(desc(userCollections.completed), desc(userCollections.updatedAt));

    res.json(collections);
  } catch (error: any) {
    console.error("[collections] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get collection details for a specific user (public)
app.get("/api/collections/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const collections = await db
      .select({
        collectionType: userCollections.collectionType,
        targetId: userCollections.targetId,
        progress: userCollections.progress,
        total: userCollections.total,
        completed: userCollections.completed,
        completedAt: userCollections.completedAt,
      })
      .from(userCollections)
      .where(eq(userCollections.userId, userId));

    res.json(collections);
  } catch (error: any) {
    console.error("[collections/public] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get user's milestones (public)
app.get("/api/milestones/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const milestones = await db
      .select({
        milestoneType: userMilestones.milestoneType,
        threshold: userMilestones.threshold,
        achievedAt: userMilestones.achievedAt,
      })
      .from(userMilestones)
      .where(eq(userMilestones.userId, userId))
      .orderBy(desc(userMilestones.achievedAt));

    res.json(milestones);
  } catch (error: any) {
    console.error("[milestones] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});
```

**ACTION 10**: Import new tables at top of `server/routes.ts`

Add to imports (around line 9):

```typescript
import {
  holdings,
  marketSnapshots,
  premiumCheckoutSessions,
  tweetSettings,
  tweetHistory,
  users,
  scoutAssignments,
  scoutHistory,
  dailyGames,
  players,
  communityCheckoutSessions,
  userCollections,
  userMilestones,
} from "@shared/schema";
```

**ACTION 11**: Create collection update job

Create `server/jobs/update-collections.ts`:

```typescript
/**
 * Collection Update Job
 *
 * Checks user holdings against collection criteria and updates progress.
 * Run every 15 minutes.
 */

import { db } from "../db";
import { userCollections, holdings, players } from "@shared/schema";
import { sql, eq, and, inArray } from "drizzle-orm";
import { broadcast } from "../websocket";
import { info } from "../lib/log-utility";

const NBA_TEAMS = [
  "ATL",
  "BOS",
  "BKN",
  "CHA",
  "CHI",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GSW",
  "HOU",
  "IND",
  "LAC",
  "LAL",
  "MEM",
  "MIA",
  "MIL",
  "MIN",
  "NOP",
  "NYK",
  "OKC",
  "ORL",
  "PHI",
  "PHX",
  "POR",
  "SAC",
  "SAS",
  "TOR",
  "UTA",
  "WAS",
];

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

export async function updateCollections(): Promise<{
  recordsProcessed: number;
  completedCount: number;
}> {
  let completedCount = 0;

  // Get all users with holdings
  const usersWithHoldings = await db
    .selectDistinct({ userId: holdings.userId })
    .from(holdings)
    .where(eq(holdings.assetType, "player"));

  for (const { userId } of usersWithHoldings) {
    // Get user's holdings with player details
    const userHoldings = await db
      .select({
        playerId: holdings.playerId,
        team: players.team,
        position: players.position,
      })
      .from(holdings)
      .innerJoin(players, eq(holdings.playerId, players.id))
      .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "player")));

    const ownedPlayerIds = new Set(userHoldings.map((h) => h.playerId));

    // Check team collections
    for (const team of NBA_TEAMS) {
      const teamPlayers = await db
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.team, team), eq(players.isActive, true)));

      const ownedOnTeam = teamPlayers.filter((p) => ownedPlayerIds.has(p.id)).length;
      const totalOnTeam = teamPlayers.length;

      if (totalOnTeam > 0) {
        const wasCompleted = await updateCollection(userId, "team", team, ownedOnTeam, totalOnTeam);
        if (wasCompleted) completedCount++;
      }
    }

    // Check position collections
    for (const position of POSITIONS) {
      const positionPlayers = await db
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.position, position), eq(players.isActive, true)));

      const ownedInPosition = positionPlayers.filter((p) => ownedPlayerIds.has(p.id)).length;
      const totalInPosition = positionPlayers.length;

      if (totalInPosition > 0) {
        const wasCompleted = await updateCollection(
          userId,
          "position",
          position,
          ownedInPosition,
          totalInPosition,
        );
        if (wasCompleted) completedCount++;
      }
    }
  }

  info(
    `[collections] Updated ${usersWithHoldings.length} users, ${completedCount} newly completed`,
  );

  return {
    recordsProcessed: usersWithHoldings.length,
    completedCount,
  };
}

async function updateCollection(
  userId: string,
  type: string,
  targetId: string,
  progress: number,
  total: number,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(userCollections)
    .where(
      and(
        eq(userCollections.userId, userId),
        eq(userCollections.collectionType, type),
        eq(userCollections.targetId, targetId),
      ),
    )
    .limit(1);

  const isCompleted = progress >= total;
  const wasAlreadyCompleted = existing[0]?.completed || false;

  if (existing.length === 0) {
    // Create new collection record
    await db.insert(userCollections).values({
      userId,
      collectionType: type,
      targetId,
      progress,
      total,
      completed: isCompleted,
      completedAt: isCompleted ? new Date() : null,
    });
  } else {
    // Update existing
    await db
      .update(userCollections)
      .set({
        progress,
        completed: isCompleted,
        completedAt: isCompleted && !wasAlreadyCompleted ? new Date() : existing[0].completedAt,
        updatedAt: new Date(),
      })
      .where(eq(userCollections.id, existing[0].id));
  }

  // Broadcast completion if newly completed
  if (isCompleted && !wasAlreadyCompleted) {
    broadcast({
      type: "collection_completed",
      userId,
      collectionType: type,
      targetId,
      progress,
      total,
    });
    return true;
  }

  return false;
}

export async function runCollectionUpdateJob(): Promise<{
  recordsProcessed: number;
  errorCount: number;
}> {
  try {
    const result = await updateCollections();
    return {
      recordsProcessed: result.recordsProcessed,
      errorCount: 0,
    };
  } catch (error: any) {
    console.error("[collections] Job failed:", error.message);
    return {
      recordsProcessed: 0,
      errorCount: 1,
    };
  }
}
```

**ACTION 12**: Create milestone check job

Create `server/jobs/check-milestones.ts`:

```typescript
/**
 * Milestone Check Job
 *
 * Checks user net worth against milestones and triggers celebrations.
 * Run every 5 minutes.
 */

import { db } from "../db";
import { userMilestones, users } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { broadcast } from "../websocket";
import { info } from "../lib/log-utility";

const NET_WORTH_MILESTONES = [
  { threshold: 1000, title: "First Thousand" },
  { threshold: 10000, title: "Ten K Club" },
  { threshold: 100000, title: "Six Figures" },
  { threshold: 1000000, title: "Millionaire" },
  { threshold: 10000000, title: "Ten Million" },
];

export async function checkMilestones(): Promise<{ checked: number; newMilestones: number }> {
  let newMilestones = 0;

  // Get all users
  const allUsers = await db
    .select({
      id: users.id,
      balance: users.balance,
    })
    .from(users);

  for (const user of allUsers) {
    const netWorth = parseFloat(user.balance || "0");

    for (const milestone of NET_WORTH_MILESTONES) {
      if (netWorth >= milestone.threshold) {
        const wasCreated = await createMilestoneIfNotExists(
          user.id,
          "netWorth",
          milestone.threshold,
          milestone.title,
        );
        if (wasCreated) newMilestones++;
      }
    }
  }

  info(`[milestones] Checked ${allUsers.length} users, ${newMilestones} new milestones`);

  return {
    checked: allUsers.length,
    newMilestones,
  };
}

async function createMilestoneIfNotExists(
  userId: string,
  type: string,
  threshold: number,
  title: string,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(userMilestones)
    .where(
      and(
        eq(userMilestones.userId, userId),
        eq(userMilestones.milestoneType, type),
        eq(userMilestones.threshold, threshold.toString()),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    // Create new milestone
    await db.insert(userMilestones).values({
      userId,
      milestoneType: type,
      threshold: threshold.toString(),
      celebrated: false,
    });

    // Broadcast achievement
    broadcast({
      type: "milestone_achieved",
      userId,
      milestoneType: type,
      threshold,
      title,
    });

    return true;
  }

  return false;
}

export async function runMilestoneCheckJob(): Promise<{
  recordsProcessed: number;
  errorCount: number;
}> {
  try {
    const result = await checkMilestones();
    return {
      recordsProcessed: result.checked,
      errorCount: 0,
    };
  } catch (error: any) {
    console.error("[milestones] Job failed:", error.message);
    return {
      recordsProcessed: 0,
      errorCount: 1,
    };
  }
}
```

**ACTION 13**: Add WebSocket types

Add to `server/websocket.ts` in SubscriptionType:

```typescript
  | 'collection_completed' // Collection completed notification
  | 'milestone_achieved'   // Milestone achieved notification
```

**ACTION 14**: Add WebSocket handlers

Add to `client/src/lib/websocket.tsx` in the switch statement:

```typescript
            case 'collection_completed':
              // Invalidate collections query
              queryClient.invalidateQueries({ queryKey: ['/api/collections'] });
              // Trigger ceremony
              window.dispatchEvent(new CustomEvent('collection-completed', {
                detail: message
              }));
              break;

            case 'milestone_achieved':
              // Invalidate milestones query
              queryClient.invalidateQueries({ queryKey: ['/api/milestones'] });
              // Trigger ceremony
              window.dispatchEvent(new CustomEvent('milestone-achieved', {
                detail: message
              }));
              break;
```

**VERIFICATION**: Run `cd server && npx tsc --noEmit` - must pass.

---

### TASK 5.5: Frontend Integration

**ACTION 15**: Add collection display to User Profile

Edit `client/src/pages/user-profile.tsx`:

Find the stats section (around line 420) and add collection badges after the stats grid:

```typescript
// Add this import at top
import { CollectionBadge } from "@/components/collections/collection-badge";
import { CollectionCeremony } from "@/components/collections/collection-ceremony";
import { MilestoneBadge } from "@/components/milestones/milestone-badge";
import { MilestoneCeremony } from "@/components/milestones/milestone-ceremony";

// Add to component state
const [collectionCeremonyOpen, setCollectionCeremonyOpen] = useState(false);
const [completedCollection, setCompletedCollection] = useState(null);
const [milestoneCeremonyOpen, setMilestoneCeremonyOpen] = useState(false);
const [achievedMilestone, setAchievedMilestone] = useState(null);

// Add queries
const { data: collections } = useQuery({
  queryKey: [`/api/collections/${userId}`],
  enabled: !!userId,
});

const { data: milestones } = useQuery({
  queryKey: [`/api/milestones/${userId}`],
  enabled: !!userId,
});

// Add useEffect for ceremony events
useEffect(() => {
  const handleCollectionCompleted = (event: CustomEvent) => {
    if (event.detail.userId === userId) {
      setCompletedCollection(event.detail);
      setCollectionCeremonyOpen(true);
    }
  };

  const handleMilestoneAchieved = (event: CustomEvent) => {
    if (event.detail.userId === userId) {
      setAchievedMilestone(event.detail);
      setMilestoneCeremonyOpen(true);
    }
  };

  window.addEventListener('collection-completed', handleCollectionCompleted as EventListener);
  window.addEventListener('milestone-achieved', handleMilestoneAchieved as EventListener);

  return () => {
    window.removeEventListener('collection-completed', handleCollectionCompleted as EventListener);
    window.removeEventListener('milestone-achieved', handleMilestoneAchieved as EventListener);
  };
}, [userId]);

// Add to JSX after stats grid, before the closing div:
{(collections?.length > 0 || milestones?.length > 0) && (
  <div className="mt-6 pt-6 border-t">
    <h3 className="text-sm font-medium text-muted-foreground mb-3">Achievements</h3>
    <div className="flex flex-wrap gap-2">
      {milestones?.slice(0, 5).map((milestone, idx) => (
        <MilestoneBadge key={idx} milestone={milestone} size="sm" />
      ))}
      {collections?.filter(c => c.completed).slice(0, 5).map((collection) => (
        <CollectionBadge
          key={`${collection.collectionType}-${collection.targetId}`}
          collection={collection}
          size="sm"
        />
      ))}
    </div>
  </div>
)}

// Add ceremony components at end of return, before closing div:
<CollectionCeremony
  isOpen={collectionCeremonyOpen}
  collection={completedCollection}
  onClose={() => setCollectionCeremonyOpen(false)}
/>

<MilestoneCeremony
  isOpen={milestoneCeremonyOpen}
  milestone={achievedMilestone}
  onClose={() => setMilestoneCeremonyOpen(false)}
/>
```

**VERIFICATION**: Profile page must compile and display badges.

---

## PHASE 6: UI JUICE

### TASK 6.1: Juicy Button

**ACTION 16**: Create `client/src/components/ui/juicy-button.tsx`

Copy this exact code:

```typescript
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface JuicyButtonProps extends React.ComponentPropsWithoutRef<typeof Button> {
  isLoading?: boolean;
  isSuccess?: boolean;
  loadingText?: string;
  successText?: string;
  glowColor?: string;
}

export function JuicyButton({
  children,
  isLoading = false,
  isSuccess = false,
  loadingText = "Loading...",
  successText = "Success!",
  glowColor = "rgba(16, 185, 129, 0.4)",
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
      className="relative inline-block"
    >
      {/* Glow effect */}
      <motion.div
        className="absolute inset-0 rounded-md -z-10"
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        style={{
          background: `radial-gradient(circle at center, ${glowColor}, transparent 70%)`,
          filter: "blur(8px)",
          transform: "scale(1.2)",
        }}
      />

      <Button
        className={cn(
          "relative overflow-hidden transition-all duration-200",
          isSuccess && "bg-emerald-500 hover:bg-emerald-600",
          className
        )}
        disabled={isLoading || props.disabled}
        {...props}
      >
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.span
              key="loading"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              {loadingText}
            </motion.span>
          ) : isSuccess ? (
            <motion.span
              key="success"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 30,
              }}
              className="flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              {successText}
            </motion.span>
          ) : (
            <motion.span
              key="default"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.span>
          )}
        </AnimatePresence>
      </Button>
    </motion.div>
  );
}
```

**VERIFICATION**: Component must compile.

---

### TASK 6.2: Animated Counter

**ACTION 17**: Create `client/src/components/ui/animated-counter.tsx`

Copy this exact code:

```typescript
import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

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
  duration = 0.6,
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

**VERIFICATION**: Component must compile.

---

### TASK 6.3: Market Pulse

**ACTION 18**: Create `client/src/components/market/market-pulse.tsx`

Copy this exact code:

```typescript
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface MarketPulseProps {
  children: React.ReactNode;
}

export function MarketPulse({ children }: MarketPulseProps) {
  const [activityLevel, setActivityLevel] = useState(0);
  const [isEvening, setIsEvening] = useState(false);

  useEffect(() => {
    const checkTime = () => {
      const et = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      const hour = new Date(et).getHours();
      setIsEvening(hour >= 18 && hour <= 23);
    };

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

    const timeInterval = setInterval(checkTime, 60000);
    const activityInterval = setInterval(fetchActivity, 30000);

    return () => {
      clearInterval(timeInterval);
      clearInterval(activityInterval);
    };
  }, []);

  return (
    <div className="relative min-h-screen">
      {/* Evening gradient overlay */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-0"
        animate={{
          opacity: isEvening ? 0.15 : 0,
          background: isEvening
            ? "radial-gradient(ellipse at top, rgba(15, 23, 42, 1), transparent 70%)"
            : "radial-gradient(ellipse at top, rgba(15, 23, 42, 0), transparent 70%)",
        }}
        transition={{ duration: 2 }}
      />

      {/* Activity pulse */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-0"
        animate={{
          opacity: [0.02, 0.05 + (activityLevel / 2000), 0.02],
        }}
        transition={{
          duration: Math.max(2, 4 - (activityLevel / 50)),
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.15), transparent 60%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
```

**ACTION 19**: Add market activity endpoint

Add to `server/routes.ts`:

```typescript
// Market activity endpoint
app.get("/api/market/activity", async (req, res) => {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const recentTrades = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .where(gte(trades.executedAt, fifteenMinutesAgo));

    const tradeCount = recentTrades[0]?.count || 0;
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

**ACTION 20**: Integrate Market Pulse in App

Edit `client/src/App.tsx`:

Add import:

```typescript
import { MarketPulse } from "@/components/market/market-pulse";
```

Wrap Router in MarketPulse in AppContent:

```typescript
// In AppContent function, replace:
<div className="pb-20 sm:pb-0 flex-1">
  <Router />
</div>

// With:
<MarketPulse>
  <div className="pb-20 sm:pb-0 flex-1">
    <Router />
  </div>
</MarketPulse>
```

**VERIFICATION**: App must compile and show subtle pulse effect.

---

## FINAL VERIFICATION

### Step 21: Run All Checks

Execute these commands in order:

```bash
# 1. TypeScript compilation
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit

# 2. Production build
npm run build

# 3. Check for console errors
# (Start dev server and check browser console)
```

### Step 22: Testing Checklist

Verify each feature:

**Collections:**

- [ ] Collection badges display in user profile
- [ ] Progress updates automatically
- [ ] Ceremony plays when collection completes
- [ ] Ceremony is skippable
- [ ] Confetti animation works

**Milestones:**

- [ ] Milestone badges display in user profile
- [ ] Ceremony plays when milestone achieved
- [ ] Number counts up during ceremony
- [ ] Ceremony is skippable
- [ ] Confetti animation works

**UI Juice:**

- [ ] JuicyButton has hover glow
- [ ] JuicyButton scales on press
- [ ] Loading state shows spinner
- [ ] Success state shows checkmark
- [ ] AnimatedCounter counts smoothly
- [ ] Counter flashes green/red on change
- [ ] MarketPulse responds to activity
- [ ] Evening mode darkens background

**General:**

- [ ] All animations use spring physics
- [ ] No bouncy easing
- [ ] Mobile responsive
- [ ] No console errors
- [ ] TypeScript compiles
- [ ] Production build succeeds

---

## DELIVERABLES

By completion, you must have:

1. ✅ 11 new components created
2. ✅ 2 new database tables (userCollections, userMilestones)
3. ✅ 2 new backend jobs (update-collections, check-milestones)
4. ✅ 4 new API endpoints
5. ✅ 2 new WebSocket event types
6. ✅ Integration in user-profile.tsx
7. ✅ MarketPulse integrated in App.tsx
8. ✅ All TypeScript errors resolved
9. ✅ Production build succeeds
10. ✅ All animations smooth and skippable

---

## TROUBLESHOOTING

**If TypeScript errors occur:**

1. Check import paths match project structure
2. Verify all new tables imported in routes.ts
3. Check that WebSocket types match exactly

**If animations don't work:**

1. Verify framer-motion is installed
2. Check spring physics values match requirements
3. Ensure AnimatePresence wraps animated content

**If ceremonies don't show:**

1. Check WebSocket connection is active
2. Verify event listeners attached correctly
3. Check that state updates trigger re-render

---

## SUCCESS CRITERIA

The implementation is successful when:

1. All checklist items verified
2. No TypeScript errors
3. Production build succeeds
4. All animations smooth at 60fps
5. Mobile experience acceptable
6. No console errors in production

**DO NOT PROCEED** until all criteria met.
