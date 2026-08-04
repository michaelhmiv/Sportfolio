import { Pool } from "pg";

const SPORTS = ["MLB", "NHL", "NASCAR"];
const VALID_STATUSES = new Set([
  "scheduled",
  "inprogress",
  "in_progress",
  "completed",
  "final",
  "postponed",
  "suspended",
  "cancelled",
  "unknown",
]);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "sportfolio-readonly-sports-semantics-audit",
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      `SELECT sport, game_id, status, start_time, home_team, away_team
       FROM daily_games
       WHERE upper(sport) = ANY($1::text[])
         AND start_time >= now() - interval '45 days'
         AND start_time < now() + interval '400 days'
       ORDER BY start_time, game_id`,
      [SPORTS],
    );
    const duplicateKeys = new Map<string, number>();
    const invalidStatuses: Array<Record<string, unknown>> = [];
    const invalidDates: Array<Record<string, unknown>> = [];
    for (const row of result.rows) {
      const key = `${String(row.sport).toUpperCase()}:${row.game_id}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
      if (!VALID_STATUSES.has(String(row.status || "").toLowerCase())) invalidStatuses.push(row);
      if (!Number.isFinite(new Date(row.start_time).getTime())) invalidDates.push(row);
    }
    const duplicates = [...duplicateKeys.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }));
    console.log(
      JSON.stringify(
        {
          mode: "read_only",
          rowCount: result.rowCount,
          duplicates,
          invalidStatuses,
          invalidDates,
          ok: duplicates.length === 0 && invalidStatuses.length === 0 && invalidDates.length === 0,
        },
        null,
        2,
      ),
    );
    await client.query("ROLLBACK");
    if (duplicates.length || invalidStatuses.length || invalidDates.length) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      mode: "read_only",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
