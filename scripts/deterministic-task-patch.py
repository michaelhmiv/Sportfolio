from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


stats_path = "server/jobs/sync-nflverse-stats.ts"
replace_once(
    stats_path,
    '''function buildGameLookup(games: any[]) {''',
    '''export function nflverseGameWeekCandidates(seasonType: string, week: number): number[] {
  if (seasonType !== "postseason") return [week];
  // nflverse continues NFL week numbering into the postseason (19-22), while
  // ESPN's postseason scoreboard numbers rounds independently. Preserve the
  // nflverse week first for compatibility, then try ESPN round numbers.
  const espnRoundByNflverseWeek: Record<number, number[]> = {
    19: [1],
    20: [2],
    21: [3],
    // ESPN commonly places the Pro Bowl in postseason week 4 and the Super Bowl
    // in week 5. Include both as defensive fallbacks; team/opponent matching
    // prevents the wrong event from being selected.
    22: [5, 4],
  };
  return [...new Set([week, ...(espnRoundByNflverseWeek[week] || [])])];
}

function buildGameLookup(games: any[]) {''',
)
replace_once(
    stats_path,
    '''            const game = gamesByKey.get(
              gameLookupKey({ season: year, seasonType, week, team, opponent }),
            );
            if (!game) {
              result.gamesMissing++;
              continue;
            }
''',
    '''            let game: any = null;
            for (const candidateWeek of nflverseGameWeekCandidates(seasonType, week)) {
              game = gamesByKey.get(
                gameLookupKey({
                  season: year,
                  seasonType,
                  week: candidateWeek,
                  team,
                  opponent,
                }),
              );
              if (game) break;
            }
            if (!game) {
              result.gamesMissing++;
              continue;
            }
''',
)

replace_once(
    "package.json",
    '    "nfl:migrate-data": "tsx scripts/nfl-data-migration.ts",\n',
    '    "nfl:migrate-data": "tsx scripts/nfl-data-migration.ts",\n    "nfl:repair-history": "tsx scripts/nfl-history-repair.ts",\n',
)

Path("server/jobs/sync-nflverse-stats.test.ts").write_text('''import { describe, expect, it } from "vitest";
import { nflverseGameWeekCandidates } from "./sync-nflverse-stats";

describe("nflverse postseason week reconciliation", () => {
  it("keeps regular-season weeks unchanged", () => {
    expect(nflverseGameWeekCandidates("regular", 12)).toEqual([12]);
  });

  it("maps nflverse continuation playoff weeks to ESPN postseason rounds", () => {
    expect(nflverseGameWeekCandidates("postseason", 19)).toEqual([19, 1]);
    expect(nflverseGameWeekCandidates("postseason", 20)).toEqual([20, 2]);
    expect(nflverseGameWeekCandidates("postseason", 21)).toEqual([21, 3]);
    expect(nflverseGameWeekCandidates("postseason", 22)).toEqual([22, 5, 4]);
  });
});
''', encoding="utf-8")

Path("scripts/nfl-history-repair.ts").write_text('''import "dotenv/config";
import { pool } from "../server/db";
import { syncNflverseStats } from "../server/jobs/sync-nflverse-stats";

const REPAIR_ID = "nfl_postseason_week_reconcile_v1";
const LOCK_NAME = "sportfolio:nfl:postseason-week-reconcile-v1";

async function main() {
  if (process.env.NODE_ENV !== "production" && process.env.NFL_MIGRATION_ALLOW_NON_PROD !== "true") {
    throw new Error("nfl:repair-history is production-only unless NFL_MIGRATION_ALLOW_NON_PROD=true");
  }
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_NAME]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS sportfolio_operational_migrations (
        id text PRIMARY KEY,
        completed_at timestamptz NOT NULL DEFAULT now(),
        details jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    const marker = await client.query(
      "SELECT 1 FROM sportfolio_operational_migrations WHERE id=$1",
      [REPAIR_ID],
    );
    if (marker.rowCount) {
      console.log(`[nfl_history_repair] ${REPAIR_ID} already completed; no-op`);
      return;
    }

    const result = await syncNflverseStats({ years: [2024, 2025] });
    console.log(`[nfl_history_repair] result ${JSON.stringify(result)}`);
    if (result.errorCount !== 0 || result.recordsProcessed === 0 || result.gamesMissing !== 0) {
      throw new Error(`NFL history repair verification failed: ${JSON.stringify(result)}`);
    }

    await client.query(
      "INSERT INTO sportfolio_operational_migrations(id, details) VALUES ($1, $2::jsonb)",
      [REPAIR_ID, JSON.stringify({ result })],
    );
    console.log(`[nfl_history_repair] ${REPAIR_ID} completed successfully`);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
      } catch (error) {
        console.warn("[nfl_history_repair] advisory unlock failed", error);
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[nfl_history_repair] failed", error);
  process.exitCode = 1;
});
''', encoding="utf-8")
