import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Trophy, Medal, Award } from "lucide-react";
import { cn } from "@/lib/utils";

interface PodiumWinner {
  rank: number;
  username: string;
  prize: number;
  avatar?: string;
}

interface ContestPodiumProps {
  isOpen: boolean;
  winners: PodiumWinner[];
  userRank?: number;
  userPrize?: number;
  onClose: () => void;
}

function PodiumCard({
  winner,
  position,
  delay,
}: {
  winner: PodiumWinner;
  position: "left" | "center" | "right";
  delay: number;
}) {
  const isFirst = position === "center";
  const height = isFirst ? "h-48" : "h-36";
  const rankColor =
    winner.rank === 1 ? "bg-yellow-500" : winner.rank === 2 ? "bg-gray-400" : "bg-amber-700";

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
        delay,
      }}
      className={cn(
        "flex flex-col items-center",
        position === "left" && "order-1",
        position === "center" && "order-2",
        position === "right" && "order-3",
      )}
    >
      {/* Winner info */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20, delay: delay + 0.2 }}
        className="mb-4 text-center"
      >
        <div className="w-16 h-16 rounded-full bg-card border-2 border-border flex items-center justify-center mx-auto mb-2">
          <span className="text-lg font-bold">{winner.username.slice(0, 2).toUpperCase()}</span>
        </div>
        <p className="font-semibold text-sm truncate max-w-[100px]">{winner.username}</p>
        <p className="text-emerald-500 font-bold">${winner.prize.toFixed(2)}</p>
      </motion.div>

      {/* Podium */}
      <motion.div
        initial={{ height: 0 }}
        animate={{ height: "auto" }}
        transition={{ duration: 0.5, delay: delay + 0.1 }}
        className={cn(
          "w-24 rounded-t-lg flex items-end justify-center pb-4 relative overflow-hidden",
          height,
          rankColor,
        )}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: delay + 0.4 }}
          className="text-white font-bold text-2xl"
        >
          #{winner.rank}
        </motion.div>

        {/* Glow effect */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.3 }}
        />
      </motion.div>
    </motion.div>
  );
}

export function ContestPodium({
  isOpen,
  winners,
  userRank,
  userPrize,
  onClose,
}: ContestPodiumProps) {
  const [showUserResult, setShowUserResult] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowUserResult(false);
      const timer = setTimeout(() => setShowUserResult(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Sort winners by rank
  const sortedWinners = [...winners].sort((a, b) => a.rank - b.rank);

  // Reorder for podium display (2nd, 1st, 3rd)
  const podiumOrder = [
    sortedWinners.find((w) => w.rank === 2),
    sortedWinners.find((w) => w.rank === 1),
    sortedWinners.find((w) => w.rank === 3),
  ].filter(Boolean) as PodiumWinner[];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={onClose}
      >
        <div className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/10 border border-yellow-500/20 mb-4">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <span className="font-medium text-yellow-500">Contest Complete</span>
            </div>
            <h2 className="text-2xl font-bold">Winners</h2>
          </motion.div>

          {/* Podium */}
          <div className="flex justify-center items-end gap-4 mb-8">
            {podiumOrder.map((winner, index) => (
              <PodiumCard
                key={winner.rank}
                winner={winner}
                position={index === 0 ? "left" : index === 1 ? "center" : "right"}
                delay={index * 0.15}
              />
            ))}
          </div>

          {/* User result */}
          <AnimatePresence>
            {showUserResult && userRank && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "p-4 rounded-lg border text-center",
                  userRank <= 3
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-muted border-border",
                )}
              >
                <p className="text-sm text-muted-foreground mb-1">Your Result</p>
                <div className="flex items-center justify-center gap-4">
                  <div>
                    <p className="text-3xl font-bold">#{userRank}</p>
                    <p className="text-xs text-muted-foreground">Rank</p>
                  </div>
                  {userPrize && userPrize > 0 && (
                    <>
                      <div className="w-px h-10 bg-border" />
                      <div>
                        <p className="text-3xl font-bold text-emerald-500">
                          ${userPrize.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">Prize</p>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Close hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-center text-xs text-muted-foreground mt-6"
          >
            Click anywhere to close
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
