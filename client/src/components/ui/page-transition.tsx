import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  mode?: "fade" | "slide" | "scale" | "slideUp";
}

export function PageTransition({ children, className, mode = "fade" }: PageTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  const variants = {
    fade: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    },
    slide: {
      initial: { opacity: 0, x: prefersReducedMotion ? 0 : 20 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: prefersReducedMotion ? 0 : -20 },
    },
    slideUp: {
      initial: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: prefersReducedMotion ? 0 : -20 },
    },
    scale: {
      initial: { opacity: 0, scale: prefersReducedMotion ? 1 : 0.95 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: prefersReducedMotion ? 1 : 0.95 },
    },
  };

  const selectedVariants = variants[mode];

  return (
    <motion.div
      initial={selectedVariants.initial}
      animate={selectedVariants.animate}
      exit={selectedVariants.exit}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: "easeOut" }}
      className={cn("w-full", className)}
    >
      {children}
    </motion.div>
  );
}

interface AnimatedRouteProps {
  children: React.ReactNode;
  routeKey: string;
  className?: string;
}

export function AnimatedRoute({ children, routeKey, className }: AnimatedRouteProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={routeKey}
        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -10 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.25, ease: "easeInOut" }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

interface SectionTransitionProps {
  children: React.ReactNode;
  show: boolean;
  className?: string;
  direction?: "vertical" | "horizontal";
}

export function SectionTransition({
  children,
  show,
  className,
  direction = "vertical",
}: SectionTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          initial={{
            opacity: 0,
            height: !prefersReducedMotion && direction === "vertical" ? 0 : "auto",
            width: !prefersReducedMotion && direction === "horizontal" ? 0 : "auto",
          }}
          animate={{
            opacity: 1,
            height: "auto",
            width: "auto",
          }}
          exit={{
            opacity: 0,
            height: !prefersReducedMotion && direction === "vertical" ? 0 : "auto",
            width: !prefersReducedMotion && direction === "horizontal" ? 0 : "auto",
          }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: "easeInOut" }}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface TabTransitionProps {
  children: React.ReactNode;
  tabKey: string;
  direction?: "left" | "right";
  className?: string;
}

export function TabTransition({
  children,
  tabKey,
  direction = "right",
  className,
}: TabTransitionProps) {
  const prefersReducedMotion = useReducedMotion();
  const offset = direction === "right" ? 20 : -20;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={tabKey}
        initial={{ opacity: 0, x: prefersReducedMotion ? 0 : offset }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -offset }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: "easeOut" }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
