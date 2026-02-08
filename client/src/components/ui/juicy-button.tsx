import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

interface JuicyButtonProps extends ComponentPropsWithoutRef<typeof Button> {
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
      className="relative inline-block"
    >
      {/* Glow effect on hover */}
      <motion.div
        className="absolute inset-0 rounded-md opacity-0 pointer-events-none"
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
          "relative transition-all duration-200",
          successState && "bg-emerald-500 hover:bg-emerald-600",
          className,
        )}
        {...props}
      >
        <AnimatePresence mode="wait">
          {loadingState ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading...</span>
            </motion.div>
          ) : successState ? (
            <motion.div
              key="success"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="flex items-center gap-2"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 30, delay: 0.1 }}
              >
                <Check className="w-4 h-4" />
              </motion.div>
              <span>Success!</span>
            </motion.div>
          ) : (
            <motion.div
              key="default"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </Button>
    </motion.div>
  );
}
