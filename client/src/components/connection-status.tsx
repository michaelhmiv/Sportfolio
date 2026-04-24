import { useWebSocket } from "@/lib/websocket";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

export function ConnectionStatus() {
  const { connectionState, reconnectAttempts } = useWebSocket();

  // Don't show anything when connected
  if (connectionState === "connected") {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 border border-border bg-background/95 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] backdrop-blur rounded-sm shadow-none"
      data-testid="connection-status"
    >
      {connectionState === "connecting" ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Connecting{reconnectAttempts > 0 ? ` (attempt ${reconnectAttempts})` : "..."}
          </span>
        </>
      ) : connectionState === "disconnected" || connectionState === "error" ? (
        <>
          <WifiOff className="h-4 w-4 text-destructive" />
          <span className="text-sm text-muted-foreground">
            Reconnecting{reconnectAttempts > 0 ? ` (attempt ${reconnectAttempts})` : "..."}
          </span>
        </>
      ) : null}
    </div>
  );
}
