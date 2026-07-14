import { broadcastToUser } from "../websocket";
import { collectionRepository } from "./postgres-repository";
import { CollectionBackendService, type CollectionEventPayload } from "./service";

export const collectionEventPublisher = {
  publish(event: CollectionEventPayload): void {
    broadcastToUser(event.userId, {
      type: "collections",
      event: `collection:${event.eventType}`,
      eventId: event.eventId,
      definitionId: event.definitionId,
      versionId: event.versionId,
      previousState: event.previousState,
      nextState: event.nextState,
      reason: event.reason,
      metadata: event.metadata,
      occurredAt: event.occurredAt.toISOString(),
    });
  },
};

export const collectionService = new CollectionBackendService(
  collectionRepository,
  collectionEventPublisher,
);
