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
        className,
      )}
      animate={isFlashing ? { scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 0.3 }}
    >
      {prefix}
      {displayValue.toFixed(decimals)}
      {suffix}
    </motion.span>
  );
}

// Specialized variants for common use cases

interface MoneyCounterProps extends Omit<AnimatedCounterProps, "prefix" | "suffix"> {
  currency?: string;
}

export function MoneyCounter({ currency = "$", ...props }: MoneyCounterProps) {
  return <AnimatedCounter prefix={currency} {...props} />;
}

interface PercentageCounterProps extends Omit<AnimatedCounterProps, "suffix"> {}

export function PercentageCounter({ decimals = 1, ...props }: PercentageCounterProps) {
  return <AnimatedCounter suffix="%" decimals={decimals} {...props} />;
}

interface ShareCounterProps extends Omit<AnimatedCounterProps, "suffix"> {}

export function ShareCounter({ decimals = 0, ...props }: ShareCounterProps) {
  return <AnimatedCounter suffix=" shares" decimals={decimals} {...props} />;
}
