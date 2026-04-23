const ET_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 5000;

const SORT_FIELDS = [
  "price",
  "volume",
  "change",
  "tvl",
  "marketCap",
  "sentiment",
  "undervalued",
  "fantasyPoints",
  "name",
  "team",
] as const;

const SORT_FIELD_ALIASES: Record<string, PlayersSortField> = {
  liquidity: "tvl",
  poolSize: "tvl",
};

export type PlayersSortField = (typeof SORT_FIELDS)[number];

export interface PlayersPagination {
  limit: number;
  offset: number;
}

export interface PlayersWatchlistScope {
  requiresWatchlistScope: boolean;
  isUnauthorized: boolean;
  watchlistUserId?: string;
  scopedWatchlistId?: string;
}

function parseInteger(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number.parseInt(value, 10);
  }

  return Number.NaN;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function extractRequestUserId(requestUser: unknown): string | null {
  if (!requestUser || typeof requestUser !== "object") {
    return null;
  }

  const userRecord = requestUser as {
    id?: unknown;
    claims?: { sub?: unknown } | null;
  };
  const directId = typeof userRecord.id === "string" ? userRecord.id.trim() : "";
  if (directId) {
    return directId;
  }

  const claimId = typeof userRecord.claims?.sub === "string" ? userRecord.claims.sub.trim() : "";
  return claimId || null;
}

export function normalizePlayersSearchQuery(input: {
  q?: unknown;
  search?: unknown;
}): string | undefined {
  const normalizedQ = typeof input.q === "string" ? input.q.trim() : "";
  if (normalizedQ.length > 0) {
    return normalizedQ;
  }

  const normalizedSearch = typeof input.search === "string" ? input.search.trim() : "";
  return normalizedSearch.length > 0 ? normalizedSearch : undefined;
}

export function normalizePlayersPagination(input: {
  limit?: unknown;
  offset?: unknown;
  page?: unknown;
}): PlayersPagination {
  const parsedLimit = parseInteger(input.limit);
  const safeLimit = Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : clamp(parsedLimit, 1, MAX_LIMIT);

  const parsedPage = parseInteger(input.page);
  const pageDerivedOffset =
    !Number.isNaN(parsedPage) && parsedPage > 0 ? (parsedPage - 1) * safeLimit : 0;
  const parsedOffsetInput = parseInteger(input.offset);
  const parsedOffset = Number.isNaN(parsedOffsetInput) ? pageDerivedOffset : parsedOffsetInput;
  const safeOffset = Number.isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);

  return {
    limit: safeLimit,
    offset: safeOffset,
  };
}

export function normalizePlayersSortField(sortBy: unknown): PlayersSortField {
  const normalizedRaw = typeof sortBy === "string" ? sortBy.trim() : "";
  if (!normalizedRaw) {
    return "volume";
  }

  const aliased = SORT_FIELD_ALIASES[normalizedRaw] || normalizedRaw;
  return SORT_FIELDS.includes(aliased as PlayersSortField)
    ? (aliased as PlayersSortField)
    : "volume";
}

export function normalizePlayersSortOrder(sortOrder: unknown): "asc" | "desc" {
  return sortOrder === "asc" ? "asc" : "desc";
}

export function resolvePlayersWatchlistScope(input: {
  isWatchlist?: unknown;
  watchlistId?: unknown;
  requestUser?: unknown;
}): PlayersWatchlistScope {
  const normalizedWatchlistId =
    typeof input.watchlistId === "string" ? input.watchlistId.trim() : "";
  const requiresWatchlistScope = input.isWatchlist === "true" || normalizedWatchlistId.length > 0;

  if (!requiresWatchlistScope) {
    return {
      requiresWatchlistScope: false,
      isUnauthorized: false,
    };
  }

  const userId = extractRequestUserId(input.requestUser);
  if (!userId) {
    return {
      requiresWatchlistScope: true,
      isUnauthorized: true,
    };
  }

  return {
    requiresWatchlistScope: true,
    isUnauthorized: false,
    watchlistUserId: userId,
    scopedWatchlistId:
      normalizedWatchlistId.length > 0 && normalizedWatchlistId !== "all"
        ? normalizedWatchlistId
        : undefined,
  };
}

export function normalizeEtDateParam(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return ET_DATE_PATTERN.test(trimmed) ? trimmed : null;
}
