import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useWebSocket } from "./websocket";
import { useAuth } from "@/hooks/useAuth";

interface NotificationContextType {
  unreadCount: number;
  incrementUnread: () => void;
  clearUnread: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const STORAGE_KEY = "sportfolio_unread_activity";

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : 0;
  });

  const { subscribe } = useWebSocket();
  const { user } = useAuth();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, unreadCount.toString());
  }, [unreadCount]);

  useEffect(() => {
    // Only increment for background events that affect the CURRENT user
    // Not for trades/events from other users or bots

    // 1. Portfolio updates (your order was filled - balance changed)
    // Only triggers when YOUR balance/holdings change from a filled order
    const unsubPortfolio = subscribe("portfolio", (data: { userId?: string }) => {
      // Only increment if this portfolio update is for the current user
      if (user?.id && data.userId === user.id) {
        setUnreadCount((prev) => prev + 1);
      }
    });

    // 2. Trade notifications - only for trades you participated in
    // Server sends userId for the trader who initiated the market order
    const unsubTrade = subscribe("trade", (data: { userId?: string }) => {
      if (user?.id && data.userId === user.id) {
        setUnreadCount((prev) => prev + 1);
      }
    });

    return () => {
      unsubPortfolio();
      unsubTrade();
    };
  }, [subscribe, user?.id]);

  const incrementUnread = useCallback(() => setUnreadCount((prev) => prev + 1), []);
  const clearUnread = useCallback(() => setUnreadCount(0), []);
  const value = useMemo(
    () => ({ unreadCount, incrementUnread, clearUnread }),
    [clearUnread, incrementUnread, unreadCount],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
