import { useInjuries, getInjurySeverity } from "@/lib/injury-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HeartPulse } from "lucide-react";

interface PlayerNameProps {
  playerId: string;
  firstName: string;
  lastName: string;
  className?: string;
  showInjury?: boolean; // Can be disabled if injury shown elsewhere
}

export function PlayerName({
  playerId,
  firstName,
  lastName,
  className = "",
  showInjury = true,
}: PlayerNameProps) {
  const { getInjury } = useInjuries();
  const injury = showInjury ? getInjury(playerId) : undefined;

  // Always use span - parent elements handle click/navigation
  // This prevents nested button issues across the site
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span data-testid={`link-player-${playerId}`}>
        {firstName} {lastName}
      </span>
      {injury && <InjuryIndicator injury={injury} />}
    </span>
  );
}

interface InjuryIndicatorProps {
  injury: {
    injuryStatus: string;
    injuryDescription?: string | null;
    injuryReturnDate?: string | null;
  };
  size?: "sm" | "md";
}

export function InjuryIndicator({ injury, size = "sm" }: InjuryIndicatorProps) {
  const severity = getInjurySeverity(injury.injuryStatus);
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  // Color based on severity
  const colorClass =
    severity >= 3
      ? "text-red-500" // Out or Doubtful
      : severity >= 2
        ? "text-orange-500" // Questionable
        : "text-yellow-500"; // Probable/Day-to-Day

  const tooltipContent = (
    <div className="text-xs max-w-[200px]">
      <div className="font-semibold text-red-400">{injury.injuryStatus}</div>
      {injury.injuryReturnDate && (
        <div className="text-muted-foreground">Return: {injury.injuryReturnDate}</div>
      )}
      {injury.injuryDescription && (
        <div className="mt-1 text-muted-foreground line-clamp-3">{injury.injuryDescription}</div>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center ${colorClass}`} aria-label="Injured">
          <HeartPulse className={iconSize} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-card border">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}
