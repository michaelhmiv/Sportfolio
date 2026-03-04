import { cn } from "@/lib/utils";

interface BackgroundPatternProps {
  variant?: "grid" | "dots" | "circuit" | "gradient-mesh" | "hexagons";
  className?: string;
  opacity?: number;
  color?: "primary" | "secondary" | "accent" | "muted";
}

export function BackgroundPattern({
  variant = "grid",
  className,
  opacity = 0.03,
  color = "primary",
}: BackgroundPatternProps) {
  const colorMap = {
    primary: "var(--primary)",
    secondary: "var(--muted-foreground)",
    accent: "var(--accent)",
    muted: "var(--muted-foreground)",
  };

  const patterns = {
    grid: (
      <svg
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity }}
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={colorMap[color]} strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    ),
    dots: (
      <svg
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity: opacity * 2 }}
      >
        <defs>
          <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill={colorMap[color]} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>
    ),
    circuit: (
      <svg
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity }}
      >
        <defs>
          <pattern id="circuit" width="60" height="60" patternUnits="userSpaceOnUse">
            <path
              d="M0 30h20v-10h20v20h20"
              fill="none"
              stroke={colorMap[color]}
              strokeWidth="0.5"
            />
            <circle cx="20" cy="30" r="2" fill={colorMap[color]} />
            <circle cx="40" cy="20" r="2" fill={colorMap[color]} />
            <circle cx="40" cy="40" r="2" fill={colorMap[color]} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#circuit)" />
      </svg>
    ),
    "gradient-mesh": (
      <div
        className="absolute inset-0"
        style={{
          opacity,
          background: `radial-gradient(circle at 20% 50%, hsl(var(${color}) / 0.15) 0%, transparent 50%),
                       radial-gradient(circle at 80% 80%, hsl(var(${color}) / 0.1) 0%, transparent 50%),
                       radial-gradient(circle at 40% 20%, hsl(var(${color}) / 0.08) 0%, transparent 50%)`,
        }}
      />
    ),
    hexagons: (
      <svg
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity }}
      >
        <defs>
          <pattern
            id="hexagons"
            width="28"
            height="49"
            patternUnits="userSpaceOnUse"
            patternTransform="scale(0.5)"
          >
            <path
              d="M13.99 9.25l13.99 8.09v16.18l-13.99 8.09L0 33.52V17.34l13.99-8.09z"
              fill="none"
              stroke={colorMap[color]}
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hexagons)" />
      </svg>
    ),
  };

  return (
    <div className={cn("absolute inset-0 overflow-hidden pointer-events-none", className)}>
      {patterns[variant]}
    </div>
  );
}

interface CardAccentProps {
  variant?: "top" | "bottom" | "left" | "right" | "corner" | "glow";
  color?: "primary" | "success" | "warning" | "destructive" | "premium";
  className?: string;
  intensity?: "low" | "medium" | "high";
}

export function CardAccent({
  variant = "top",
  color = "primary",
  className,
  intensity = "medium",
}: CardAccentProps) {
  const colorMap = {
    primary: "bg-primary",
    success: "bg-emerald-500",
    warning: "bg-yellow-500",
    destructive: "bg-red-500",
    premium: "bg-amber-500",
  };

  const intensityMap = {
    low: "opacity-30",
    medium: "opacity-50",
    high: "opacity-80",
  };

  const variants = {
    top: `h-1 w-full absolute top-0 left-0 ${colorMap[color]} ${intensityMap[intensity]}`,
    bottom: `h-1 w-full absolute bottom-0 left-0 ${colorMap[color]} ${intensityMap[intensity]}`,
    left: `w-1 h-full absolute top-0 left-0 ${colorMap[color]} ${intensityMap[intensity]}`,
    right: `w-1 h-full absolute top-0 right-0 ${colorMap[color]} ${intensityMap[intensity]}`,
    corner: `w-8 h-8 absolute top-0 right-0 ${colorMap[color]} ${intensityMap[intensity]} rounded-bl-lg`,
    glow: `absolute inset-0 ${colorMap[color]} ${intensityMap[intensity]} blur-xl -z-10`,
  };

  return <div className={cn(variants[variant], className)} />;
}

interface DecorativeIconProps {
  icon: React.ReactNode;
  variant?: "circle" | "square" | "diamond";
  size?: "sm" | "md" | "lg";
  color?: "primary" | "success" | "warning" | "destructive" | "premium" | "muted";
  className?: string;
  glow?: boolean;
}

export function DecorativeIcon({
  icon,
  variant = "circle",
  size = "md",
  color = "primary",
  className,
  glow = false,
}: DecorativeIconProps) {
  const sizeMap = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  const colorMap = {
    primary: "bg-primary/10 text-primary border-primary/20",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    destructive: "bg-red-500/10 text-red-500 border-red-500/20",
    premium: "bg-amber-500/15 text-yellow-500 border-yellow-500/30",
    muted: "bg-muted text-muted-foreground border-border",
  };

  const variantMap = {
    circle: "rounded-sm",
    square: "rounded-md",
    diamond: "rounded-md rotate-45",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center border",
        sizeMap[size],
        colorMap[color],
        variantMap[variant],
        glow && "ring-1 ring-border/60",
        className,
      )}
    >
      <div className={variant === "diamond" ? "-rotate-45" : ""}>{icon}</div>
    </div>
  );
}

interface StatusIndicatorProps {
  status: "live" | "upcoming" | "completed" | "locked" | "open";
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function StatusIndicator({
  status,
  size = "md",
  showLabel = false,
  className,
}: StatusIndicatorProps) {
  const sizeMap = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  };

  const statusMap = {
    live: {
      color: "bg-red-500",
      label: "LIVE",
      pulse: true,
    },
    upcoming: {
      color: "bg-blue-500",
      label: "Upcoming",
      pulse: false,
    },
    completed: {
      color: "bg-muted-foreground",
      label: "Completed",
      pulse: false,
    },
    locked: {
      color: "bg-orange-500",
      label: "Locked",
      pulse: false,
    },
    open: {
      color: "bg-emerald-500",
      label: "Open",
      pulse: false,
    },
  };

  const { color, label, pulse } = statusMap[status];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("relative", sizeMap[size])}>
        <div className={cn("rounded-sm", color, sizeMap[size])} />
        {pulse && (
          <div
            className={cn("absolute inset-0 rounded-sm animate-ping", color, sizeMap[size])}
            style={{ opacity: 0.4 }}
          />
        )}
      </div>
      {showLabel && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
    </div>
  );
}

interface TierBadgeProps {
  tier: 1 | 2 | 3 | 4 | 5;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function TierBadge({ tier, size = "md", className }: TierBadgeProps) {
  const sizeMap = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
    lg: "text-sm px-3 py-1.5",
  };

  const tierMap = {
    1: { color: "bg-blue-500/10 text-blue-500 border-blue-500/30", label: "1x" },
    2: { color: "bg-blue-500/10 text-blue-500 border-blue-500/30", label: "2x" },
    3: { color: "bg-violet-500/10 text-violet-500 border-violet-500/30", label: "3x" },
    4: { color: "bg-orange-500/10 text-orange-500 border-orange-500/30", label: "4x" },
    5: { color: "bg-red-500/10 text-red-500 border-red-500/30", label: "5x" },
  };

  const { color, label } = tierMap[tier];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono font-bold border rounded",
        sizeMap[size],
        color,
        className,
      )}
    >
      {tier >= 4 && "+"}
      {label}
    </span>
  );
}

interface MedalProps {
  rank: 1 | 2 | 3;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Medal({ rank, size = "md", className }: MedalProps) {
  const sizeMap = {
    sm: "w-5 h-5 text-[10px]",
    md: "w-6 h-6 text-xs",
    lg: "w-8 h-8 text-sm",
  };

  const medalMap = {
    1: { color: "bg-yellow-500/20 text-yellow-200", icon: "1" },
    2: { color: "bg-slate-400/20 text-slate-200", icon: "2" },
    3: { color: "bg-amber-700/20 text-amber-100", icon: "3" },
  };

  const { color, icon } = medalMap[rank];

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-sm font-bold shadow-none",
        sizeMap[size],
        color,
        className,
      )}
    >
      {icon}
    </div>
  );
}

interface GradientBorderProps {
  children: React.ReactNode;
  variant?: "primary" | "success" | "warning" | "premium";
  intensity?: "low" | "medium" | "high";
  className?: string;
}

export function GradientBorder({
  children,
  variant = "primary",
  intensity = "medium",
  className,
}: GradientBorderProps) {
  const intensityMap = {
    low: "p-[1px]",
    medium: "p-[2px]",
    high: "p-[3px]",
  };

  const gradientMap = {
    primary: "from-primary/50 via-primary to-primary/50",
    success: "from-emerald-500/50 via-emerald-500 to-emerald-500/50",
    warning: "from-yellow-500/50 via-yellow-500 to-yellow-500/50",
    premium: "from-yellow-400 via-amber-500 to-yellow-600",
  };

  return (
    <div
      className={cn(
        "rounded-sm border border-border bg-card",
        gradientMap[variant],
        intensityMap[intensity],
        className,
      )}
    >
      <div className="h-full w-full rounded-sm bg-card">{children}</div>
    </div>
  );
}
