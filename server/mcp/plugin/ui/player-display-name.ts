type JsonRecord = Record<string, unknown>;

export const PLAYER_NAME_UNAVAILABLE = "Name unavailable";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePlayerDisplayName(value: unknown): string {
  const player = record(value);
  return (
    text(player.playerName) ||
    text(player.displayName) ||
    text(player.name) ||
    [text(player.firstName), text(player.lastName)].filter(Boolean).join(" ") ||
    PLAYER_NAME_UNAVAILABLE
  );
}

export function normalizePlayerDisplayNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizePlayerDisplayNames(entry));
  if (!value || typeof value !== "object") return value;

  const source = value as JsonRecord;
  const normalized: JsonRecord = {};
  for (const [key, child] of Object.entries(source)) {
    normalized[key] = normalizePlayerDisplayNames(child);
  }

  const looksPlayerBearing =
    typeof source.playerId === "string" ||
    typeof source.playerName === "string" ||
    typeof source.displayName === "string" ||
    typeof source.firstName === "string" ||
    typeof source.lastName === "string";
  if (looksPlayerBearing) {
    normalized.displayName = resolvePlayerDisplayName(source);
  }

  if (source.player && typeof source.player === "object" && !Array.isArray(source.player)) {
    const player = record(normalized.player);
    normalized.player = { ...player, displayName: resolvePlayerDisplayName(source.player) };
  }

  return normalized;
}
