import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

interface BoostNearMissData {
  playerName: string;
  fantasyPoints: number;
  threshold: number;
  pointsMissed: number;
  potentialPayout: number;
}

interface BoostNearMissDetectorProps {
  data: BoostNearMissData | null;
}

export function useBoostNearMissDetector() {
  const { toast } = useToast();

  const checkNearMiss = (data: BoostNearMissData | null) => {
    if (!data) return;

    const { playerName, fantasyPoints, threshold, pointsMissed, potentialPayout } = data;

    // Only show if within 3 points of threshold
    if (pointsMissed <= 3 && pointsMissed > 0) {
      toast({
        title: "So Close! 🔥",
        description: `${playerName} scored ${fantasyPoints.toFixed(1)} FP - just ${pointsMissed.toFixed(1)} points from the ${threshold} FP tier! You missed out on $${potentialPayout.toFixed(2)}.`,
        variant: "default",
        duration: 8000,
      });
    }
  };

  return { checkNearMiss };
}

// Hook to use in components
export function BoostNearMissDetector({ data }: BoostNearMissDetectorProps) {
  const { checkNearMiss } = useBoostNearMissDetector();

  useEffect(() => {
    checkNearMiss(data);
  }, [data, checkNearMiss]);

  return null;
}
