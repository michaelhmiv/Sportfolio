import { cn } from "@/lib/utils";

interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  positive?: boolean; // force colour when caller knows direction
  className?: string;
}

/**
 * Lightweight pure-SVG price sparkline.
 * Renders a 7-day (or N-point) mini line chart with no Recharts dependency.
 */
export function Sparkline({ points, width = 48, height = 24, positive, className }: SparklineProps) {
  if (!points || points.length < 2) {
    return <span className={cn("inline-block opacity-30 text-muted-foreground text-[10px]", className)}>–</span>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const toX = (i: number) => (i / (points.length - 1)) * width;
  const toY = (v: number) => height - ((v - min) / range) * (height - 2) - 1;

  const pathD = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(" ");

  const isUp = positive !== undefined ? positive : points[points.length - 1] >= points[0];
  const stroke = isUp ? "rgb(16 185 129)" : "rgb(239 68 68)"; // emerald-500 / red-500

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("inline-block flex-shrink-0", className)}
      aria-hidden="true"
    >
      <path d={pathD} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
