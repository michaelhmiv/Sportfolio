import { Loader2, WifiOff } from "lucide-react";
import { useWebSocket } from "@/lib/websocket";
import { cn } from "@/lib/utils";

export function ConnectionStatus() {
  const { connectionState, reconnectAttempts } = useWebSocket();

  if (connectionState === "connected") return null;

  const isConnecting = connectionState === "connecting";
  const label = isConnecting ? "Connecting" : "Reconnecting";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-50 flex items-center gap-2 rounded-pill border px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] shadow-medium backdrop-blur sm:bottom-4 sm:right-4",
        "border-reconnecting/30 bg-reconnecting-subtle text-reconnecting",
      )}
      data-testid="connection-status"
    >
      {isConnecting ? (
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <WifiOff className="h-4 w-4" aria-hidden="true" />
      )}
      <span>
        {label}
        {reconnectAttempts > 0 ? ` · attempt ${reconnectAttempts}` : ""}
      </span>
    </div>
  );
}
