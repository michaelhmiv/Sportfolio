import type { MlbCatalogPreview } from "./catalog-preview";

export interface ExistingCollectionSlot {
  id: string;
  slotKey: string;
  playerId: string | null;
  requiredQuantity: string;
  status: string;
}

export interface PlannedCollectionSlot {
  existingSlotId: string | null;
  slotKey: string;
  playerId: string;
  slotLabel: string;
  requiredQuantity: string;
  rank: number | null;
  statKey: string | null;
  qualificationValue: string | null;
  qualificationMetadata: Record<string, unknown>;
  displayOrder: number;
}

export interface MembershipRefreshPlan {
  slots: PlannedCollectionSlot[];
  removedSlotIds: string[];
  invalidatedSlotIds: string[];
  added: number;
  removed: number;
  replaced: number;
  metadataUpdated: number;
  changed: boolean;
}

function normalizeQuantity(value: string | number): string {
  return Number(value).toFixed(4);
}

export function planMembershipRefresh(
  preview: MlbCatalogPreview,
  existingSlots: ExistingCollectionSlot[],
): MembershipRefreshPlan {
  if (!preview.ok) throw new Error(`Cannot plan failed preview ${preview.definition.slug}`);
  if (preview.definition.kind !== "player_slots") {
    throw new Error(`Cannot plan player membership for master ${preview.definition.slug}`);
  }

  const existingByKey = new Map(existingSlots.map((slot) => [slot.slotKey, slot]));
  const incomingKeys = new Set<string>();
  const invalidatedSlotIds: string[] = [];
  let added = 0;
  let replaced = 0;
  let metadataUpdated = 0;

  const requiredQuantity = normalizeQuantity(preview.definition.slotQuantity);
  const slots = preview.members.map((member, displayOrder) => {
    const slotKey = `mlbam:${member.mlbamId}`;
    if (incomingKeys.has(slotKey)) throw new Error(`Duplicate incoming slot ${slotKey}`);
    incomingKeys.add(slotKey);
    const existing = existingByKey.get(slotKey);
    if (!existing) {
      added += 1;
    } else {
      const membershipChanged =
        existing.playerId !== member.playerId ||
        normalizeQuantity(existing.requiredQuantity) !== requiredQuantity ||
        existing.status !== "active";
      if (membershipChanged) {
        replaced += 1;
        invalidatedSlotIds.push(existing.id);
      } else {
        metadataUpdated += 1;
      }
    }

    return {
      existingSlotId: existing?.id || null,
      slotKey,
      playerId: member.playerId,
      slotLabel: member.playerName,
      requiredQuantity,
      rank: member.rank,
      statKey: member.statKey,
      qualificationValue: member.qualificationValue,
      qualificationMetadata: {
        mlbamId: member.mlbamId,
        position: member.position,
        ...member.sourceMetadata,
      },
      displayOrder,
    };
  });

  const removedSlotIds = existingSlots
    .filter((slot) => slot.status !== "removed" && !incomingKeys.has(slot.slotKey))
    .map((slot) => slot.id);
  invalidatedSlotIds.push(...removedSlotIds);

  return {
    slots,
    removedSlotIds,
    invalidatedSlotIds: Array.from(new Set(invalidatedSlotIds)),
    added,
    removed: removedSlotIds.length,
    replaced,
    metadataUpdated,
    changed: added > 0 || removedSlotIds.length > 0 || replaced > 0,
  };
}
