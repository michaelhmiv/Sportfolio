import type { CollectionDetailResponse, CollectionListEntry } from "@shared/collection-api";
import { CollectionDomainError } from "./state-engine";
import type { CollectionReadRepository } from "./read-repository";

export interface CollectionReadService {
  listCollections(userId: string): Promise<CollectionListEntry[]>;
  getCollectionBySlug(userId: string, slug: string): Promise<CollectionDetailResponse>;
}

export class CollectionApiReadService implements CollectionReadService {
  constructor(private readonly readRepository: CollectionReadRepository) {}

  async listCollections(userId: string): Promise<CollectionListEntry[]> {
    return this.readRepository.listCollections(userId);
  }

  async getCollectionBySlug(userId: string, slug: string): Promise<CollectionDetailResponse> {
    const detail = await this.readRepository.getCollectionBySlug(userId, slug);
    if (!detail) {
      throw new CollectionDomainError("COLLECTION_NOT_FOUND", "Collection was not found", 404, {
        slug,
      });
    }
    return detail;
  }
}
