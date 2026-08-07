export type PlayerActivityFilter = "active" | "inactive" | "all";

export function normalizePlayerActivityFilter(value: unknown): PlayerActivityFilter | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "active" || normalized === "inactive" || normalized === "all") {
    return normalized;
  }
  return undefined;
}

export function resolvePlayerActivityFilter(input: {
  explicit?: PlayerActivityFilter;
  search?: string | null;
}): PlayerActivityFilter {
  if (input.explicit) return input.explicit;
  return input.search?.trim() ? "all" : "active";
}

export function assertPlayerScoutable(
  player: { isActive?: boolean | null } | null | undefined,
): void {
  if (!player) throw new Error("Player not found");
  if (player.isActive !== true) throw new Error("Inactive players cannot be scouted");
}
