import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  Inbox,
  Search,
  FileQuestion,
  ShoppingCart,
  TrendingUp,
  Users,
  Trophy,
  Wallet,
  Droplets,
} from "lucide-react";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  icon?:
    | "inbox"
    | "search"
    | "file"
    | "cart"
    | "chart"
    | "users"
    | "trophy"
    | "wallet"
    | "droplets"
    | React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  size?: "sm" | "md" | "lg";
  variant?: "default" | "terminal";
}

const iconMap = {
  inbox: Inbox,
  search: Search,
  file: FileQuestion,
  cart: ShoppingCart,
  chart: TrendingUp,
  users: Users,
  trophy: Trophy,
  wallet: Wallet,
  droplets: Droplets,
};

export function EmptyState({
  title,
  description,
  icon = "inbox",
  action,
  className,
  size = "md",
  variant = "default",
  ...props
}: EmptyStateProps) {
  const isTerminal = variant === "terminal";
  const sizeClasses = {
    sm: {
      container: "py-6",
      icon: "w-10 h-10",
      title: "text-sm",
      description: "text-xs",
    },
    md: {
      container: "py-12",
      icon: "w-16 h-16",
      title: "text-lg",
      description: "text-sm",
    },
    lg: {
      container: "py-16",
      icon: "w-24 h-24",
      title: "text-xl",
      description: "text-base",
    },
  };

  const IconComponent =
    typeof icon === "string" && icon in iconMap ? iconMap[icon as keyof typeof iconMap] : null;
  const sizes = sizeClasses[size];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        isTerminal && "terminal-empty rounded-sm border border-border bg-card px-5 py-5",
        sizes.container,
        className,
      )}
      {...(props as any)}
    >
      <motion.div
        animate={
          isTerminal
            ? { opacity: 1 }
            : {
                y: [0, -8, 0],
                scale: [1, 1.02, 1],
              }
        }
        transition={
          isTerminal
            ? undefined
            : {
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut",
              }
        }
        className={cn(
          "relative mb-4",
          isTerminal && "mb-3 rounded-sm border border-border bg-[hsl(var(--sidebar)/0.4)] p-3",
        )}
      >
        {!isTerminal ? (
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.1, 0.2, 0.1],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute inset-0 rounded-sm bg-primary/10 blur-xl"
          />
        ) : null}
        {IconComponent ? (
          <IconComponent
            className={cn(
              "relative z-10 text-muted-foreground/50",
              sizes.icon,
              isTerminal && "h-8 w-8 text-primary",
            )}
          />
        ) : (
          <div className={cn("relative z-10", sizes.icon)}>{icon}</div>
        )}
      </motion.div>

      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className={cn(
          "mb-1 text-foreground",
          sizes.title,
          isTerminal
            ? "font-mono text-sm font-semibold uppercase tracking-[0.1em]"
            : "font-semibold",
        )}
      >
        {title}
      </motion.h3>

      {description && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className={cn(
            "mb-4 max-w-sm text-muted-foreground",
            sizes.description,
            isTerminal && "font-mono text-[11px] leading-6 uppercase tracking-[0.04em]",
          )}
        >
          {description}
        </motion.p>
      )}

      {action && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <motion.div
            animate={
              isTerminal
                ? { opacity: 1 }
                : {
                    scale: [1, 1.02, 1],
                    boxShadow: [
                      "0 0 0 0 rgba(var(--primary), 0)",
                      "0 0 0 8px rgba(var(--primary), 0.1)",
                      "0 0 0 0 rgba(var(--primary), 0)",
                    ],
                  }
            }
            transition={
              isTerminal
                ? undefined
                : {
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
            className="rounded-md"
          >
            <Button
              onClick={action.onClick}
              size={size === "sm" ? "sm" : "default"}
              variant={isTerminal ? "terminalOutline" : "default"}
            >
              {action.label}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}

interface NoResultsProps {
  query?: string;
  className?: string;
}

export function NoResults({ query, className }: NoResultsProps) {
  return (
    <EmptyState
      icon="search"
      title="No results found"
      description={
        query
          ? `We couldn't find anything matching "${query}". Try different keywords.`
          : "Try adjusting your search or filters."
      }
      className={className}
    />
  );
}

interface EmptyPortfolioProps {
  onBrowse?: () => void;
  className?: string;
}

export function EmptyPortfolio({ onBrowse, className }: EmptyPortfolioProps) {
  return (
    <EmptyState
      icon="wallet"
      title="Your portfolio is empty"
      description="Start trading to build your portfolio. Browse player pools to find players to invest in."
      action={onBrowse ? { label: "Browse Player Pools", onClick: onBrowse } : undefined}
      className={className}
    />
  );
}

interface LoadingEmptyStateProps {
  className?: string;
}

export function LoadingEmptyState({ className }: LoadingEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12", className)}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="h-8 w-8 rounded-sm border-2 border-primary border-t-transparent"
      />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-4 text-sm text-muted-foreground"
      >
        Loading...
      </motion.p>
    </div>
  );
}
