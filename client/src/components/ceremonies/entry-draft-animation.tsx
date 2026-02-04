import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { X, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LineupEntry {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  sharesEntered: number;
  maxShares: number;
}

interface EntryDraftAnimationProps {
  isOpen: boolean;
  lineup: LineupEntry[];
  contestName: string;
  onClose: () => void;
  onComplete?: () => void;
}

// Individual card component that deals from deck and flips
function DraftCard({
  entry,
  index,
  totalCards,
  onComplete,
}: {
  entry: LineupEntry;
  index: number;
  totalCards: number;
  onComplete?: () => void;
}) {
  const [isFlipped, setIsFlipped] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Staggered flip timing
    const flipTimer = setTimeout(() => {
      setIsFlipped(true);
    }, 600 + index * 150);

    return () => clearTimeout(flipTimer);
  }, [index]);

  // Calculate grid position based on index
  const getGridPosition = () => {
    if (totalCards <= 2) {
      // 1-2 cards: horizontal center
      return {
        x: (index - (totalCards - 1) / 2) * 220,
        y: -100,
      };
    } else if (totalCards <= 4) {
      // 3-4 cards: 2x2 grid
      const row = Math.floor(index / 2);
      const col = index % 2;
      return {
        x: (col - 0.5) * 220,
        y: row === 0 ? -180 : -20,
      };
    } else {
      // 5+ cards: 3 columns
      const row = Math.floor(index / 3);
      const col = index % 3;
      const colsInRow = Math.min(3, totalCards - row * 3);
      return {
        x: (col - (colsInRow - 1) / 2) * 200,
        y: -200 + row * 160,
      };
    }
  };

  const targetPos = getGridPosition();

  return (
    <motion.div
      ref={cardRef}
      className="absolute w-44 perspective-1000"
      initial={{
        x: 0,
        y: 200,
        opacity: 0,
        scale: 0.8,
        rotateY: 0,
      }}
      animate={{
        x: targetPos.x,
        y: targetPos.y,
        opacity: 1,
        scale: 1,
        rotateY: isFlipped ? 180 : 0,
      }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
        delay: index * 0.1,
        opacity: { duration: 0.2 },
      }}
      style={{
        transformStyle: "preserve-3d",
      }}
    >
      {/* Card Front (Hidden side initially) */}
      <div
        className={cn(
          "absolute inset-0 rounded-xl border-2 bg-gradient-to-br from-slate-800 to-slate-900",
          "flex items-center justify-center backface-hidden",
          "border-slate-700"
        )}
        style={{
          backfaceVisibility: "hidden",
          transform: "rotateY(180deg)",
        }}
      >
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-2">
            <span className="text-lg font-bold text-primary">
              {entry.playerName.split(" ").map((n) => n[0]).join("")}
            </span>
          </div>
          <p className="text-sm font-semibold text-white truncate px-2">
            {entry.playerName}
          </p>
          <p className="text-xs text-slate-400">
            {entry.team} · {entry.position}
          </p>
          <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
            <Users className="w-3 h-3" />
            {entry.sharesEntered} shares
          </div>
        </div>
      </div>

      {/* Card Back (Deck side - visible initially) */}
      <div
        className={cn(
          "absolute inset-0 rounded-xl border-2",
          "bg-gradient-to-br from-violet-900/50 to-blue-900/50",
          "border-violet-500/30 flex items-center justify-center backface-hidden"
        )}
        style={{
          backfaceVisibility: "hidden",
        }}
      >
        <div className="text-center">
          <Trophy className="w-8 h-8 text-violet-400 mx-auto mb-2" />
          <p className="text-xs text-violet-300 font-medium">DRAFT</p>
          <p className="text-[10px] text-violet-400/60">#{index + 1}</p>
        </div>
        {/* Card pattern overlay */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(139,92,246,0.3),transparent_70%)]" />
        </div>
      </div>
    </motion.div>
  );
}

export function EntryDraftAnimation({
  isOpen,
  lineup,
  contestName,
  onClose,
  onComplete,
}: EntryDraftAnimationProps) {
  const [showSkip, setShowSkip] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (isOpen) {
      startTimeRef.current = Date.now();
      setShowSkip(false);
      setShowComplete(false);

      // Show skip button after 1 second
      const skipTimer = setTimeout(() => setShowSkip(true), 1000);

      // Show complete state after animation finishes
      const completeTimer = setTimeout(() => {
        setShowComplete(true);
        onComplete?.();
      }, 2000 + lineup.length * 150);

      return () => {
        clearTimeout(skipTimer);
        clearTimeout(completeTimer);
      };
    }
  }, [isOpen, lineup.length, onComplete]);

  const handleSkip = () => {
    const duration = Date.now() - startTimeRef.current;
    console.log(`[EntryDraft] Skipped after ${duration}ms`);
    onClose();
  };

  if (!isOpen || lineup.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={handleSkip}
      >
        {/* Close button */}
        {showSkip && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              handleSkip();
            }}
          >
            <X className="w-5 h-5" />
          </motion.button>
        )}

        <div
          className="w-full max-w-4xl mx-4 flex flex-col items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-center mb-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 mb-4">
              <Trophy className="w-4 h-4 text-violet-500" />
              <span className="text-sm font-medium text-violet-500">
                Entry Submitted
              </span>
            </div>
            <h2 className="text-2xl font-bold mb-1">{contestName}</h2>
            <p className="text-muted-foreground">
              Dealing your lineup...
            </p>
          </motion.div>

          {/* Cards container */}
          <div className="relative h-96 w-full flex items-center justify-center">
            {lineup.map((entry, index) => (
              <DraftCard
                key={entry.playerId}
                entry={entry}
                index={index}
                totalCards={lineup.length}
              />
            ))}
          </div>

          {/* Complete state */}
          <AnimatePresence>
            {showComplete && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mt-8"
              >
                <div className="inline-flex flex-col items-center p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-sm text-muted-foreground mb-1">Total Shares Entered</p>
                  <p className="text-4xl font-bold text-emerald-500">
                    {lineup.reduce((sum, e) => sum + e.sharesEntered, 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {lineup.length} players
                  </p>
                </div>

                <Button
                  className="mt-6"
                  onClick={handleSkip}
                >
                  View My Entries
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Skip hint */}
          {showSkip && !showComplete && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-xs text-muted-foreground mt-6"
            >
              Click anywhere to skip
            </motion.p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
