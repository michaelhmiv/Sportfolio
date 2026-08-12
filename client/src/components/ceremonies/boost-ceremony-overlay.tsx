import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Flame, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BoostCeremonyData {
  playerName: string;
  playerTeam: string;
  slotTier: number;
  effectiveMultiplier: number;
  sharesBurned: number;
  payout: string;
  boostBonus: string;
  baseComponent: string;
  gameEps: string;
}

export function BoostCeremonyOverlay({
  isOpen,
  data,
  onClose,
}: {
  isOpen: boolean;
  data: BoostCeremonyData | null;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {isOpen && data ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl"
            initial={reduceMotion ? false : { scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={reduceMotion ? undefined : { scale: 0.96, y: 8 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2">
                  <Flame className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Boost settled
                  </div>
                  <div className="font-semibold">{data.playerName}</div>
                  {data.playerTeam && (
                    <div className="text-xs text-muted-foreground">{data.playerTeam}</div>
                  )}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                aria-label="Close boost ceremony"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Effective tier</div>
                <div className="font-mono text-xl font-bold">{data.effectiveMultiplier}x</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Singles burned</div>
                <div className="font-mono text-xl font-bold">
                  {data.sharesBurned.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Base earnings</div>
                <div className="font-mono font-semibold">
                  {Number(data.baseComponent).toFixed(2)} SB
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Boost bonus</div>
                <div className="font-mono font-semibold text-positive">
                  +{Number(data.boostBonus).toFixed(2)} SB
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-muted/50 p-3 text-center">
              <div className="text-xs text-muted-foreground">Total game economics</div>
              <div className="font-mono text-2xl font-bold">
                {Number(data.payout).toFixed(2)} SB
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Game EPS {Number(data.gameEps).toFixed(4)} · slot {data.slotTier}x
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
