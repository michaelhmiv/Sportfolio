import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { addNetworkListener } from "@/lib/native-network";

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const remove = addNetworkListener(setIsOnline);
    return remove;
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-2 bg-destructive/90 px-4 py-2 text-destructive-foreground text-sm font-medium"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>No connection — showing cached data</span>
    </div>
  );
}
