import { pool } from "./db";

export type GameBoxscoreRecord<T = Record<string, unknown>> = {
  gameId: string;
  sport: string;
  provider: string;
  payload: T;
  reconciliationStatus: "live" | "final_provisional" | "complete";
  isFinal: boolean;
  sourceFetchedAt: Date;
};

let schemaPromise: Promise<void> | null = null;

export function ensureGameBoxscoresSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = pool
      .query(
        `
        CREATE TABLE IF NOT EXISTS game_boxscores (
          game_id text PRIMARY KEY,
          sport text NOT NULL,
          provider text NOT NULL,
          boxscore_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          reconciliation_status text NOT NULL DEFAULT 'live',
          is_final boolean NOT NULL DEFAULT false,
          source_fetched_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS game_boxscores_sport_idx ON game_boxscores(sport);
        CREATE INDEX IF NOT EXISTS game_boxscores_final_idx ON game_boxscores(sport, is_final);
      `,
      )
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

export async function upsertGameBoxscore<T extends Record<string, unknown>>(input: {
  gameId: string;
  sport: string;
  provider: string;
  payload: T;
  reconciliationStatus: "live" | "final_provisional" | "complete";
  isFinal: boolean;
  sourceFetchedAt?: Date;
}): Promise<void> {
  await ensureGameBoxscoresSchema();
  await pool.query(
    `INSERT INTO game_boxscores (
       game_id, sport, provider, boxscore_json, reconciliation_status, is_final, source_fetched_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     ON CONFLICT (game_id) DO UPDATE SET
       sport = EXCLUDED.sport,
       provider = EXCLUDED.provider,
       boxscore_json = EXCLUDED.boxscore_json,
       reconciliation_status = EXCLUDED.reconciliation_status,
       is_final = EXCLUDED.is_final,
       source_fetched_at = EXCLUDED.source_fetched_at,
       updated_at = now()`,
    [
      input.gameId,
      input.sport,
      input.provider,
      JSON.stringify(input.payload),
      input.reconciliationStatus,
      input.isFinal,
      input.sourceFetchedAt || new Date(),
    ],
  );
}

export async function getGameBoxscore<T = Record<string, unknown>>(
  gameId: string,
): Promise<GameBoxscoreRecord<T> | null> {
  await ensureGameBoxscoresSchema();
  const result = await pool.query(
    `SELECT game_id, sport, provider, boxscore_json, reconciliation_status, is_final, source_fetched_at
       FROM game_boxscores WHERE game_id = $1 LIMIT 1`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    gameId: row.game_id,
    sport: row.sport,
    provider: row.provider,
    payload: row.boxscore_json as T,
    reconciliationStatus: row.reconciliation_status,
    isFinal: Boolean(row.is_final),
    sourceFetchedAt: new Date(row.source_fetched_at),
  };
}
