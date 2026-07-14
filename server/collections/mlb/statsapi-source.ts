import {
  fetchAwardRecipients,
  fetchSeasonStatSplits,
  type MlbAwardRecipient as StatsApiAwardRecipient,
  type MlbSeasonStatSplit as StatsApiSeasonStatSplit,
} from "../../mlb-statsapi";
import type {
  MlbAwardRecipient,
  MlbCollectionSource,
  MlbSeasonStatSplit,
} from "./catalog-importer";

function mapSeasonSplit(row: StatsApiSeasonStatSplit): MlbSeasonStatSplit {
  return row;
}

function mapAwardRecipient(row: StatsApiAwardRecipient): MlbAwardRecipient {
  return row;
}

export const mlbStatsApiCollectionSource: MlbCollectionSource = {
  async fetchSeasonStats(input) {
    const rows = await fetchSeasonStatSplits(input);
    return rows.map(mapSeasonSplit);
  },
  async fetchAwardRecipients(awardId, season) {
    const rows = await fetchAwardRecipients(awardId, season);
    return rows.map(mapAwardRecipient);
  },
};
