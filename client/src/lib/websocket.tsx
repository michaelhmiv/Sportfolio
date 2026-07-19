import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { queryClient } from "@/lib/queryClient";
import {
  debouncedInvalidatePortfolio,
  debouncedInvalidateScouts,
  debouncedInvalidatePlayer,
  debouncedInvalidateMarketActivity,
} from "@/lib/cache-invalidation";
import { resolveWebSocketUrl } from "@/lib/native-runtime";
import { useToast } from "@/hooks/use-toast";

const IS_DEV = import.meta.env.DEV;

function debugLog(stage: string, message: string, data?: any) {
  if (!IS_DEV) return;
  const elapsed = performance.now().toFixed(0);
  console.log(`[WS ${elapsed}ms] ${stage}: ${message}`, data || "");
}

export function rememberCollectionEvent(
  seenEventIds: Set<string>,
  eventId: string,
  limit = 512,
): boolean {
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.add(eventId);
  if (seenEventIds.size > limit) {
    const oldest = seenEventIds.values().next().value;
    if (oldest) seenEventIds.delete(oldest);
  }
  return true;
}

export function collectionMembershipNotice(message: any): string | null {
  if (
    message.type !== "collections" ||
    message.eventType !== "membership_changed" ||
    !["tracking_refresh", "final_correction"].includes(message.reason)
  ) {
    return null;
  }
  return "Leaderboard membership changed. Any displaced-player shares were automatically released.";
}

interface WebSocketContextValue {
  isConnected: boolean;
  connectionState: "connecting" | "connected" | "disconnected" | "error";
  reconnectAttempts: number;
  lastMessageAt: number | null;
  freshnessState: "live" | "catching_up" | "offline";
  subscribe: (eventType: string, handler: (data: any) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const seenCollectionEventIdsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFreshnessNow(Date.now());
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const connect = () => {
    const wsUrl = resolveWebSocketUrl("/ws");

    debugLog("CONNECT", `Attempting to connect to ${wsUrl}`, {
      attempt: reconnectAttemptsRef.current + 1,
    });
    setConnectionState("connecting");

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        debugLog("OPEN", "WebSocket connected successfully");
        setIsConnected(true);
        setConnectionState("connected");
        setLastMessageAt(Date.now());
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);
      };

      ws.onmessage = (event) => {
        try {
          setLastMessageAt(Date.now());
          const message = JSON.parse(event.data);

          if (message.type === "collections" && typeof message.eventId === "string") {
            if (!rememberCollectionEvent(seenCollectionEventIdsRef.current, message.eventId))
              return;
          }

          const handlers = handlersRef.current.get(message.type);
          if (handlers) {
            handlers.forEach((handler) => handler(message));
          }

          switch (message.type) {
            case "portfolio":
              debouncedInvalidatePortfolio();
              break;

            case "scouts":
              debouncedInvalidateScouts();
              break;

            case "trade":
              debouncedInvalidatePlayer(message.playerId);
              break;

            case "collections": {
              queryClient.invalidateQueries({ queryKey: ["/api/me/collections"] });
              const notice = collectionMembershipNotice(message);
              if (notice) {
                toast({
                  title: "Collection roster updated",
                  description: notice,
                });
              }
              break;
            }

            case "liveStats":
              if (message.gameId) {
                queryClient.invalidateQueries({ queryKey: ["/api/games/today"] });
                queryClient.invalidateQueries({ queryKey: ["/api/game", message.gameId] });
                // Also invalidate boosts to update live fantasy points
                queryClient.invalidateQueries({ queryKey: ["/api/daily-boosts/all"] });
              }
              break;

            case "scout_ready":
              // Trigger scout ceremony notification
              window.dispatchEvent(
                new CustomEvent("scout-ceremony-ready", {
                  detail: message.data,
                }),
              );
              break;

            case "whale_alert":
              // Trigger whale alert notification
              window.dispatchEvent(
                new CustomEvent("whale-alert", {
                  detail: message,
                }),
              );
              break;

            case "boost_count_update":
              // Update boost counters
              queryClient.setQueryData(
                ["boost-count", message.playerId, message.date],
                message.count,
              );
              break;

            case "scout_velocity_update":
              // Update scout velocity data
              queryClient.setQueryData(["scout-velocity", message.playerId], {
                playerId: message.playerId,
                velocity: message.velocity,
                totalScouts: message.totalScouts,
                isTrending: message.isTrending,
              });
              break;

            case "trending_players_update":
              // Update trending players list
              queryClient.setQueryData(["trending-players"], message.playerIds);
              break;

            case "marketActivity":
              debouncedInvalidateMarketActivity();
              // Handle collection and milestone events within marketActivity
              if (message.data?.event === "collection_completed") {
                // Trigger collection ceremony
                window.dispatchEvent(
                  new CustomEvent("collection-completed", {
                    detail: message.data,
                  }),
                );
                // Invalidate collections cache
                queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
              } else if (message.data?.event === "milestone_achieved") {
                // Trigger milestone ceremony
                window.dispatchEvent(
                  new CustomEvent("milestone-achieved", {
                    detail: message.data,
                  }),
                );
                // Invalidate milestones cache
                queryClient.invalidateQueries({ queryKey: ["/api/milestones"] });
              }
              break;
          }
        } catch (error) {
          debugLog("MESSAGE_ERROR", "Failed to parse message", { error: (error as Error).message });
        }
      };

      ws.onerror = (error) => {
        debugLog("ERROR", "WebSocket error occurred", { error });
        setConnectionState("error");
      };

      ws.onclose = (event) => {
        debugLog("CLOSE", "WebSocket disconnected", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        setIsConnected(false);
        setConnectionState("disconnected");
        wsRef.current = null;

        reconnectAttemptsRef.current++;
        setReconnectAttempts(reconnectAttemptsRef.current);

        const delay = Math.min(3000 * Math.pow(1.5, reconnectAttemptsRef.current - 1), 30000);
        debugLog("RECONNECT", `Will attempt reconnect in ${delay}ms`, {
          attempt: reconnectAttemptsRef.current,
        });

        reconnectTimeoutRef.current = setTimeout(() => {
          debugLog("RECONNECT", "Attempting to reconnect...");
          connect();
        }, delay);
      };

      wsRef.current = ws;
    } catch (error) {
      debugLog("CONNECT_ERROR", "Failed to create WebSocket", { error: (error as Error).message });
      setConnectionState("error");

      const delay = Math.min(3000 * Math.pow(1.5, reconnectAttemptsRef.current), 30000);
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttemptsRef.current++;
        setReconnectAttempts(reconnectAttemptsRef.current);
        connect();
      }, delay);
    }
  };

  useEffect(() => {
    debugLog("INIT", "WebSocketProvider mounted, initiating connection");
    connect();

    return () => {
      debugLog("CLEANUP", "WebSocketProvider unmounting");
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const subscribe = useCallback((eventType: string, handler: (data: any) => void) => {
    if (!handlersRef.current.has(eventType)) {
      handlersRef.current.set(eventType, new Set());
    }
    handlersRef.current.get(eventType)!.add(handler);

    return () => {
      const handlers = handlersRef.current.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          handlersRef.current.delete(eventType);
        }
      }
    };
  }, []);

  const freshnessState: "live" | "catching_up" | "offline" =
    connectionState !== "connected"
      ? "offline"
      : lastMessageAt === null
        ? reconnectAttempts > 0
          ? "catching_up"
          : "live"
        : freshnessNow - lastMessageAt <= 30000
          ? "live"
          : freshnessNow - lastMessageAt <= 120000
            ? "catching_up"
            : "offline";

  const value = useMemo(
    () => ({
      isConnected,
      connectionState,
      reconnectAttempts,
      lastMessageAt,
      freshnessState,
      subscribe,
    }),
    [connectionState, freshnessState, isConnected, lastMessageAt, reconnectAttempts, subscribe],
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within WebSocketProvider");
  }
  return context;
}
