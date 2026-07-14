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
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 border-b border-offline/30 bg-offline-subtle px-4 py-2 text-sm font-semibold text-offline shadow-medium"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Offline · showing cached market data</span>
    </div>
  );
}
