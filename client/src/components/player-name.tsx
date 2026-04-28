import { useInjuries, getInjurySeverity } from "@/lib/injury-context";
import { openPlayerModal } from "@/lib/player-modal-events";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HeartPulse } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

  const handleOpenModal = (event: React.MouseEvent | React.KeyboardEvent) => {
    openPlayerModal(playerId);
  };

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        role="button"
        tabIndex={0}
        onClick={handleOpenModal}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleOpenModal(event);
          }
        }}
        data-testid={`link-player-${playerId}`}
        className="cursor-pointer underline-offset-2 hover:underline focus-visible:underline"
      >
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

interface StatusChipProps {
  isActive?: boolean;
  injuryStatus?: string | null;
  injuryDescription?: string | null;
  injuryReturnDate?: string | null;
  size?: "sm" | "md";
}

/** Renders an "Inactive" badge and/or InjuryIndicator based on player status. */
export function StatusChip({
  isActive = true,
  injuryStatus,
  injuryDescription,
  injuryReturnDate,
  size = "sm",
}: StatusChipProps) {
  return (
    <>
      {!isActive && (
        <Badge
          variant="outline"
          className="h-4 px-1 py-0 text-[9px] text-muted-foreground uppercase"
        >
          Inactive
        </Badge>
      )}
      {injuryStatus && (
        <InjuryIndicator
          injury={{ injuryStatus, injuryDescription, injuryReturnDate }}
          size={size}
        />
      )}
    </>
  );
}
