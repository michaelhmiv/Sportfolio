import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useState, useEffect } from "react";
import { Button, ButtonProps } from "./button";
import { cn } from "@/lib/utils";
import { Loader2, Check, X } from "lucide-react";

interface LoadingButtonProps extends ButtonProps {
  loading?: boolean;
  success?: boolean;
  error?: boolean;
  loadingText?: string;
  successText?: string;
  errorText?: string;
  successDuration?: number;
  errorDuration?: number;
}

export function LoadingButton({
  children,
  loading = false,
  success = false,
  error = false,
  loadingText,
  successText,
  errorText,
  successDuration = 2000,
  errorDuration = 2000,
  className,
  disabled,
  ...props
}: LoadingButtonProps) {
  const shouldReduceMotion = useReducedMotion();
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    if (success) {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), successDuration);
      return () => clearTimeout(timer);
    }
  }, [success, successDuration]);

  useEffect(() => {
    if (error) {
      setShowError(true);
      const timer = setTimeout(() => setShowError(false), errorDuration);
      return () => clearTimeout(timer);
    }
  }, [error, errorDuration]);

  const getContent = () => {
    if (loading) {
      if (shouldReduceMotion) {
        return (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4" aria-hidden="true" />
            {loadingText || children}
          </span>
        );
      }
      return (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-2"
        >
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {loadingText || children}
        </motion.span>
      );
    }

    if (showSuccess) {
      if (shouldReduceMotion) {
        return (
          <span className="flex items-center gap-2">
            <Check className="h-4 w-4" aria-hidden="true" />
            {successText || "Success!"}
          </span>
        );
      }
      return (
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="flex items-center gap-2"
        >
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </motion.span>
          {successText || "Success!"}
        </motion.span>
      );
    }

    if (showError) {
      if (shouldReduceMotion) {
        return (
          <span className="flex items-center gap-2">
            <X className="h-4 w-4" aria-hidden="true" />
            {errorText || "Error"}
          </span>
        );
      }
      return (
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="flex items-center gap-2"
        >
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1, rotate: [0, -10, 10, 0] }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </motion.span>
          {errorText || "Error"}
        </motion.span>
      );
    }

    return children;
  };

  return (
    <Button
      className={cn(
        "relative overflow-hidden transition-all duration-standard",
        showSuccess &&
          "bg-market-positive text-content-inverse hover:bg-market-positive/90 disabled:bg-market-positive disabled:text-content-inverse",
        showError &&
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-destructive disabled:text-destructive-foreground",
        className,
      )}
      disabled={disabled || loading || showSuccess || showError}
      {...props}
    >
      <AnimatePresence mode="wait" initial={!shouldReduceMotion}>
        {getContent()}
      </AnimatePresence>
    </Button>
  );
}

interface AnimatedSubmitButtonProps extends ButtonProps {
  isPending?: boolean;
  isSuccess?: boolean;
  isError?: boolean;
}

export function AnimatedSubmitButton({
  children,
  isPending = false,
  isSuccess = false,
  isError = false,
  className,
  disabled,
  ...props
}: AnimatedSubmitButtonProps) {
  return (
    <LoadingButton
      loading={isPending}
      success={isSuccess}
      error={isError}
      loadingText="Submitting..."
      successText="Done!"
      errorText="Failed"
      className={className}
      disabled={disabled}
      {...props}
    >
      {children}
    </LoadingButton>
  );
}

interface PulsingButtonProps extends ButtonProps {
  pulse?: boolean;
}

export function PulsingButton({
  children,
  pulse = false,
  className,
  ...props
}: PulsingButtonProps) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      animate={
        pulse && !shouldReduceMotion
          ? {
              scale: [1, 1.02, 1],
              boxShadow: [
                "0 0 0 0 hsl(var(--brand) / 0)",
                "0 0 0 8px hsl(var(--brand) / 0.2)",
                "0 0 0 0 hsl(var(--brand) / 0)",
              ],
            }
          : {}
      }
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut",
      }}
      className="inline-block rounded-control"
    >
      <Button className={className} {...props}>
        {children}
      </Button>
    </motion.div>
  );
}
