export interface PlayerSearchCandidate {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  team?: string | null;
  position?: string | null;
  sport?: string | null;
}

export function normalizePlayerSearchQuery(query: string): string {
  return (query || "").trim().replace(/\s+/g, " ");
}

export function appendPlayerSearchParam(params: URLSearchParams, query: string): void {
  const normalized = normalizePlayerSearchQuery(query);
  if (normalized.length > 0) {
    params.set("q", normalized);
  } else {
    params.delete("q");
  }
}

export function matchesPlayerSearch(candidate: PlayerSearchCandidate, query: string): boolean {
  const normalized = normalizePlayerSearchQuery(query).toLowerCase();
  if (!normalized) return true;

  const compactQuery = normalized.replace(/\s+/g, "");
  const fullName = `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim().toLowerCase();
  const compactFullName = fullName.replace(/\s+/g, "");

  const fields = [
    fullName,
    (candidate.firstName || "").toLowerCase(),
    (candidate.lastName || "").toLowerCase(),
    (candidate.team || "").toLowerCase(),
    (candidate.position || "").toLowerCase(),
    (candidate.sport || "").toLowerCase(),
    (candidate.id || "").toLowerCase(),
  ].filter(Boolean);

  if (fullName.includes(normalized)) return true;
  if (compactQuery && compactFullName.includes(compactQuery)) return true;
  if (fields.some((field) => field.includes(normalized))) return true;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > 1) {
    return tokens.every((token) => fields.some((field) => field.includes(token)));
  }

  return false;
}
