/**
 * WebSocket Broadcasting Service
 *
 * Centralized WebSocket management for real-time updates.
 * Shared by routes and background jobs.
 *
 * OPTIMIZATION: Supports per-client subscription filtering to reduce
 * broadcast overhead. Clients subscribe to specific event types and
 * only receive relevant updates.
 */

import { WebSocket } from "ws";

// Subscription types for filtering
export type SubscriptionType =
  | "portfolio" // User's portfolio changes
  | "scouts" // Scout assignment changes
  | "trade" // Order/trade updates
  | "liveStats" // Game stats updates
  | "marketActivity" // Market-wide activity
  | "scout_payout" // Scout distribution notifications
  | "boost_settled" // Boost settlement notifications
  | "COMMUNITY_BOOST_SETTLED" // Community boost settlement
  | "vesting" // Vesting notifications
  | "scout_update" // Scout update notifications
  | "scout_ready" // Scout ceremony ready notification
  | "whale_alert" // Large trade alerts
  | "scout_velocity_update" // Scout velocity updates
  | "trending_players_update" // Trending players updates
  | "all"; // Receive all events

interface ClientSubscription {
  ws: WebSocket;
  subscriptions: Set<SubscriptionType>;
  userId?: string;
}

const wsClients = new Map<WebSocket, ClientSubscription>();

// Track debug message frequency to reduce logging
let lastBroadcastLogTime = 0;
const BROADCAST_LOG_INTERVAL = 60000; // Log every 60 seconds

export function addClient(ws: WebSocket, userId?: string) {
  wsClients.set(ws, {
    ws,
    subscriptions: new Set<SubscriptionType>(["all"]), // Default to all
    userId,
  });
  const now = Date.now();
  if (now - lastBroadcastLogTime > BROADCAST_LOG_INTERVAL) {
    console.log(`[WebSocket] Client connected (total: ${wsClients.size})`);
    lastBroadcastLogTime = now;
  }
}

export function removeClient(ws: WebSocket) {
  wsClients.delete(ws);
  const now = Date.now();
  if (now - lastBroadcastLogTime > BROADCAST_LOG_INTERVAL) {
    console.log(`[WebSocket] Client disconnected (total: ${wsClients.size})`);
    lastBroadcastLogTime = now;
  }
}

/**
 * Subscribe a client to specific event types
 */
export function subscribe(ws: WebSocket, types: SubscriptionType[]) {
  const client = wsClients.get(ws);
  if (client) {
    client.subscriptions.delete("all"); // Remove 'all' when subscribing to specific types
    types.forEach((type) => client.subscriptions.add(type));
  }
}

/**
 * Unsubscribe from specific event types
 */
export function unsubscribe(ws: WebSocket, types: SubscriptionType[]) {
  const client = wsClients.get(ws);
  if (client) {
    types.forEach((type) => client.subscriptions.delete(type));
    // If no subscriptions left, default to all
    if (client.subscriptions.size === 0) {
      client.subscriptions.add("all");
    }
  }
}

/**
 * Get client subscriptions (for debugging/admin)
 */
export function getClientSubscriptions(ws: WebSocket): SubscriptionType[] {
  const client = wsClients.get(ws);
  return client ? Array.from(client.subscriptions) : [];
}

export function broadcast(
  message: { type: SubscriptionType; [key: string]: unknown },
  excludeWs?: WebSocket,
) {
  const payload = JSON.stringify(message);
  let sent = 0;
  const now = Date.now();

  wsClients.forEach((client) => {
    // Skip excluded client
    if (client.ws === excludeWs) return;

    // Check subscription filter
    if (!client.subscriptions.has("all") && !client.subscriptions.has(message.type)) {
      return; // Client not subscribed to this event type
    }

    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
      sent++;
    }
  });

  // Only log periodically to reduce I/O
  if (sent > 0 && now - lastBroadcastLogTime > BROADCAST_LOG_INTERVAL) {
    console.log(`[WebSocket] Broadcasted ${message.type} to ${sent} clients`);
    lastBroadcastLogTime = now;
  }
}

export function broadcastToAll(message: any) {
  // Legacy function - sends to all clients regardless of subscriptions
  const payload = JSON.stringify(message);
  let sent = 0;
  const now = Date.now();

  wsClients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
      sent++;
    }
  });

  if (sent > 0 && now - lastBroadcastLogTime > BROADCAST_LOG_INTERVAL) {
    console.log(`[WebSocket] Broadcasted ${message.type} to ${sent} clients`);
    lastBroadcastLogTime = now;
  }
}

/**
 * Aggregate WebSocket client stats for admin diagnostics.
 * Never returns message payloads or any secrets.
 */
export function getWebSocketStats(): {
  totalClients: number;
  uniqueUsers: number;
  subscriptions: Record<string, number>;
} {
  const subscriptions: Record<string, number> = {};
  const users = new Set<string>();

  wsClients.forEach((client) => {
    if (client.userId) users.add(client.userId);
    client.subscriptions.forEach((s) => {
      subscriptions[s] = (subscriptions[s] || 0) + 1;
    });
  });

  return {
    totalClients: wsClients.size,
    uniqueUsers: users.size,
    subscriptions,
  };
}

export function getClientCount(): number {
  return wsClients.size;
}

export function getConnectedClientsInfo(): Array<{
  userId?: string;
  subscriptions: SubscriptionType[];
}> {
  return Array.from(wsClients.entries()).map(([_, client]) => ({
    userId: client.userId,
    subscriptions: Array.from(client.subscriptions),
  }));
}

/**
 * Broadcast a message to all connected clients for a specific user
 */
export function broadcastToUser(
  userId: string,
  message: { type: SubscriptionType; [key: string]: unknown },
) {
  const payload = JSON.stringify(message);
  let sent = 0;
  const now = Date.now();

  wsClients.forEach((client) => {
    // Only send to clients belonging to this user
    if (client.userId !== userId) return;

    // Check subscription filter
    if (!client.subscriptions.has("all") && !client.subscriptions.has(message.type)) {
      return; // Client not subscribed to this event type
    }

    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
      sent++;
    }
  });

  // Only log periodically to reduce I/O
  if (sent > 0 && now - lastBroadcastLogTime > BROADCAST_LOG_INTERVAL) {
    console.log(`[WebSocket] Broadcasted ${message.type} to user ${userId} (${sent} clients)`);
    lastBroadcastLogTime = now;
  }
}
