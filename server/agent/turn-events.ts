import type { Request, Response } from "express";
import type { AgentTurnProgressEvent, AgentTurnProgressUpdate } from "./types";

type TurnStreamKey = `${string}:${string}:${string}`;

const TERMINAL_EVENT_TYPES = new Set<AgentTurnProgressEvent["eventType"]>([
  "turn_completed",
  "turn_failed",
]);

function buildKey(input: { userId: string; threadId: string; turnId: string }): TurnStreamKey {
  return `${input.userId}:${input.threadId}:${input.turnId}`;
}

class AgentTurnEventStreamManager {
  private streams = new Map<TurnStreamKey, Set<Response>>();

  registerClient(input: {
    userId: string;
    threadId: string;
    turnId: string;
    req: Request;
    res: Response;
  }) {
    const key = buildKey(input);
    if (!this.streams.has(key)) {
      this.streams.set(key, new Set());
    }
    this.streams.get(key)!.add(input.res);

    const unregister = () => {
      const clients = this.streams.get(key);
      if (!clients) {
        return;
      }
      clients.delete(input.res);
      if (clients.size === 0) {
        this.streams.delete(key);
      }
    };

    input.req.on("close", unregister);
    input.req.on("error", unregister);
    input.res.on("close", unregister);
    input.res.on("error", unregister);
  }

  emit(input: {
    userId: string;
    threadId: string;
    turnId: string;
    event: AgentTurnProgressUpdate;
  }) {
    const key = buildKey(input);
    const clients = this.streams.get(key);
    if (!clients || clients.size === 0) {
      return;
    }

    const payload: AgentTurnProgressEvent = {
      turnId: input.turnId,
      threadId: input.threadId,
      timestamp: new Date().toISOString(),
      eventType: input.event.eventType,
      status: input.event.status,
      summary: input.event.summary,
      phase: input.event.phase,
      toolName: input.event.toolName || null,
      passIndex: input.event.passIndex,
      elapsedMs: input.event.elapsedMs ?? null,
      details: input.event.details || null,
    };
    const encoded = `data: ${JSON.stringify(payload)}\n\n`;

    clients.forEach((res) => {
      try {
        res.write(encoded);
      } catch (_error) {
        // best-effort streaming only
      }
    });

    if (TERMINAL_EVENT_TYPES.has(payload.eventType)) {
      setTimeout(() => this.closeAllForKey(key), 150);
    }
  }

  private closeAllForKey(key: TurnStreamKey) {
    const clients = this.streams.get(key);
    if (!clients) {
      return;
    }
    clients.forEach((res) => {
      if (!res.writableEnded) {
        res.end();
      }
    });
    this.streams.delete(key);
  }
}

export const agentTurnEventStreamManager = new AgentTurnEventStreamManager();
