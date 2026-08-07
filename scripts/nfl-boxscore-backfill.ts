import "dotenv/config";
import { pool } from "../server/db";
import { syncNFLStats } from "../server/jobs/sync-nfl-stats";

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function compactDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  return value.replaceAll("-", "");
}

async function main() {
  const from = getArg("from");
  const to = getArg("to") || from;
  if (!from || !to)
    throw new Error("Usage: npm run nfl:backfill-boxscores -- --from=YYYY-MM-DD --to=YYYY-MM-DD");
  const dates = `${compactDate(from)}-${compactDate(to)}`;
  const result = await syncNFLStats(new Date(`${to}T23:59:59.000Z`), { dates, forceFinal: true });
  console.log(`[nfl_boxscore_backfill] ${JSON.stringify({ from, to, ...result })}`);
  if (result.errorCount > 0 || result.gamesProcessed === 0 || result.boxscoresWritten === 0) {
    throw new Error(`NFL box-score backfill verification failed: ${JSON.stringify(result)}`);
  }
}

main()
  .catch((error) => {
    console.error("[nfl_boxscore_backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
