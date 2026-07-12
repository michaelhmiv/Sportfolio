// Season helper: Get current competitive season patterns (regular + playoffs, exclude preseason)
// Returns array of season strings to include in queries.
export function getCurrentCompetitiveSeasons(sport: string = "NBA"): string[] {
  const normalizedSport = (sport || "NBA").toUpperCase();
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  if (normalizedSport === "NFL") {
    const seasonYear = currentMonth < 8 ? currentYear - 1 : currentYear;
    return [String(seasonYear), String(seasonYear - 1)];
  }

  if (normalizedSport === "MLB" || normalizedSport === "NASCAR") {
    return [String(currentYear), String(currentYear - 1)];
  }

  const seasonStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;
  const seasonEndYear = seasonStartYear + 1;

  if (normalizedSport === "NHL") {
    // NHL ingestion persists official compact season IDs (for example 20252026).
    return [`${seasonStartYear}${seasonEndYear}`, `${seasonStartYear - 1}${seasonStartYear}`];
  }

  return [
    `${seasonStartYear}-${seasonEndYear}-regular`,
    `${seasonStartYear}-${seasonEndYear}-playoff`,
    `${seasonStartYear - 1}-${seasonStartYear}-regular`,
    `${seasonStartYear - 1}-${seasonStartYear}-playoff`,
  ];
}
