/**
 * Identity WebSocket events — publication and invalidation hook.
 *
 * The identity-changed event exposes ONLY userId + timestamp; no badge/progress
 * internals.  Consumers re-fetch via the public identity API on receipt.
 */

// ── event type ───────────────────────────────────────────────────────────────

export interface IdentityChangedEvent {
  userId: string;
  /** ISO 8601 timestamp of when the identity was invalidated. */
  timestamp: string;
}

// ── publication (must be imported after the websocket module is loaded) ──────

let _broadcast: ((message: { type: "identity"; [key: string]: unknown }) => void) | null = null;

export function setBroadcastFn(
  fn: (message: { type: "identity"; [key: string]: unknown }) => void,
): void {
  _broadcast = fn;
}

/**
 * Publish an identity-changed event to all connected clients.
 * Exposes ONLY userId + timestamp.
 */
export function broadcastIdentityChanged(userId: string): void {
  if (!_broadcast) return;
  const event: IdentityChangedEvent = {
    userId,
    timestamp: new Date().toISOString(),
  };
  _broadcast({ type: "identity", data: event });
}

// ── invalidation hook ────────────────────────────────────────────────────────

/**
 * Call this from every server-side mutation that changes publicly visible
 * identity data: trophy case save, collection completion/reactivation/
 * deactivation, username/avatar/premium change, account deletion.
 *
 * This is a direct call — NOT a side-effect listener — so the invalidation
 * is explicit and traceable.
 */
export function invalidateIdentity(userId: string): void {
  broadcastIdentityChanged(userId);
}
