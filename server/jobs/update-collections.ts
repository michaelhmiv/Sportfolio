import { collectionService } from "../collections/runtime";

export interface CollectionReconciliationRunner {
  reconcileAll(limit?: number): Promise<{
    scanned: number;
    repaired: number;
    errors: number;
    publishedEvents: number;
  }>;
}

export async function runCollectionReconciliation(
  service: CollectionReconciliationRunner,
  limit = 500,
): Promise<{
  scanned: number;
  repaired: number;
  errors: number;
  publishedEvents: number;
}> {
  return service.reconcileAll(limit);
}

/**
 * Safety-net reconciliation for versioned collections.
 *
 * User-triggered allocation and completion writes evaluate synchronously. This
 * job only rebuilds derived state for anomalous/stale rows; it never awards a
 * collection or guesses membership from the legacy user_collections table.
 */
export async function updateCollectionsJob(): Promise<void> {
  const result = await runCollectionReconciliation(collectionService);
  console.log(
    `[Collections] Reconciliation scanned=${result.scanned} repaired=${result.repaired} ` +
      `errors=${result.errors} events=${result.publishedEvents}`,
  );
}
